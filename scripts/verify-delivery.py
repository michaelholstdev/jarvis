"""Opt-in real Piper/Pulse delivery probe; records only a temporary silent sink monitor.

Run: .venv/bin/python scripts/verify-delivery.py /path/to/Thorsten.onnx
PCM stays in memory. No physical microphone or audible device is opened.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.main import load_config  # noqa: E402
from apps.audio.output import Output, verify_voice  # noqa: E402

TEXT = 'Berlin ist die Hauptstadt. München liegt in Bayern. Hamburg hat einen Hafen.'
PREFIXES = [27, 52, 76]
RATE = 48000


async def trial(model: str, device: str, mode: str, baseline: list[dict]) -> list[dict]:
    import numpy as np

    config = load_config()
    config['audio'].update(mode='piper', output_device=device)
    config['tts']['model_path'] = str(Path(model).resolve())
    config['features']['voice_stop'] = False
    verify_voice(config)
    output = Output(config)
    recorder = await asyncio.create_subprocess_exec(
        'parec', '--raw', '--format=s16le', f'--rate={RATE}', '--channels=1',
        '--latency-msec=10', f'--device={device}.monitor', stdout=-1, stderr=-1,
    )
    active_samples = 0
    reports = []
    reached = asyncio.Event()
    started = 0.0

    async def capture() -> None:
        nonlocal active_samples
        assert recorder.stdout
        while block := await recorder.stdout.readexactly(960):
            active_samples += int(np.count_nonzero(np.abs(np.frombuffer(block, dtype='<i2').astype('int32')) > 32))

    capture_task = asyncio.create_task(capture())

    def delivered(chars: int) -> None:
        reports.append({'chars': chars, 'elapsed_ms': round((time.monotonic() - started) * 1000),
                        'active_audio_ms': round(active_samples * 1000 / RATE)})
        reached.set()

    try:
        await output.start()
        await output.run({'type': 'synthesize', 'operation_id': 'synthesis', 'text': TEXT})
        await asyncio.sleep(.2)  # monitor ready before starting output
        started = time.monotonic()
        if mode == 'before-output':
            result = await output.run({'type': 'cancel', 'operation_id': 'cancel', 'target_operation_id': 'synthesis'})
            assert result['delivered_chars'] == 0 and active_samples == 0
        else:
            playing = asyncio.create_task(output.run({'type': 'play', 'operation_id': 'reply', 'text': TEXT}, on_delivery=delivered))
            if mode == 'full':
                result = await asyncio.wait_for(playing, 30)
                assert result == {'completed': True, 'delivered_chars': len(TEXT)}
                assert [r['chars'] for r in reports] == PREFIXES
                assert all(r['active_audio_ms'] > 200 for r in reports), 'delivery requires independent observed PCM'
            else:
                if mode == 'during-first':
                    await asyncio.sleep(.7)
                elif mode == 'during-second':
                    await asyncio.wait_for(reached.wait(), 15)
                    await asyncio.sleep(.7)
                else:
                    # Use measured real baseline, not text length or generated token timing.
                    await asyncio.sleep((baseline[-1]['elapsed_ms'] - 350) / 1000)
                result = await output.run({'type': 'cancel', 'operation_id': 'cancel', 'target_operation_id': 'reply'})
                await playing
                count = result['delivered_chars']
                expected = {'during-first': 0, 'during-second': 27, 'near-completion': 52}[mode]
                assert count == expected, (mode, count, reports)
                await asyncio.sleep(.15)  # collect the already submitted server tail
                measured = active_samples * 1000 / RATE
                if count:
                    required = next(r['active_audio_ms'] for r in baseline if r['chars'] == count)
                    assert measured >= required * .85, 'reported prefix exceeds independently observed audio'
                assert 100 < measured < baseline[-1]['active_audio_ms'], 'interruption must contain real partial audio'
                consumed = await output.run({'type': 'cancel', 'operation_id': 'late-cancel', 'target_operation_id': 'reply'})
                assert consumed['delivered_chars'] == 0
        print(json.dumps({'trial': mode, 'result': result, 'delivery_reports': reports,
                          'active_audio_ms': round(active_samples * 1000 / RATE),
                          'elapsed_ms': round((time.monotonic() - started) * 1000)}), flush=True)
        return reports
    finally:
        await output.stop()
        if recorder.returncode is None:
            recorder.terminate()
        capture_task.cancel()
        await asyncio.gather(capture_task, return_exceptions=True)
        await recorder.communicate()


async def check(model: str, device: str) -> None:
    baseline = await trial(model, device, 'full', [])
    for mode in ('before-output', 'during-first', 'during-second', 'near-completion'):
        await trial(model, device, mode, baseline)


if __name__ == '__main__':
    device = 'jarvis_delivery_validation'
    module = subprocess.check_output(['pactl', 'load-module', 'module-null-sink',
                                      f'sink_name={device}', f'rate={RATE}'], text=True).strip()
    try:
        asyncio.run(check(sys.argv[1], device))
    finally:
        subprocess.run(['pactl', 'unload-module', module], check=True)
