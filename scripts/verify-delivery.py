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
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.main import load_config  # noqa: E402
from apps.audio.output import Output, verify_voice  # noqa: E402
from scripts.delivery_evidence import verify_prefix  # noqa: E402

SENTENCES = ['Berlin ist die Hauptstadt. ', 'München liegt in Bayern. ', 'Hamburg hat einen Hafen.']
TEXT = ''.join(SENTENCES)
SEED = 42
PREFIXES = [27, 52, 76]
RATE = 48000


def reference_pcm(model: str) -> list[bytes]:
    # A separate seeded inference session establishes sample boundaries without
    # consulting worker events. Production synthesis settings remain unchanged.
    import onnxruntime as ort
    ort.disable_telemetry_events()
    ort.set_seed(SEED)
    import numpy as np
    import piper
    import soxr

    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    session = ort.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider'])
    voice = piper.PiperVoice(session=session, config=piper.PiperConfig.from_dict(
        json.loads(Path(model + '.json').read_text())))
    pcm = []
    for sentence in SENTENCES:
        audio = np.concatenate([chunk.audio_float_array for chunk in voice.synthesize(sentence)])
        audio = soxr.resample(audio, voice.config.sample_rate, RATE)
        pcm.append((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    return pcm


async def trial(model: str, device: str, mode: str, baseline_ms: int, reference: list[bytes]) -> int:
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
    snapshots: list[tuple[int, bytes]] = []
    captured = bytearray()
    reached = asyncio.Event()
    started = 0.0

    async def capture() -> None:
        nonlocal active_samples
        assert recorder.stdout
        while block := await recorder.stdout.readexactly(960):
            captured.extend(block)
            assert len(captured) <= RATE * 2 * 60, 'capture exceeds 60 seconds'
            active_samples += int(np.count_nonzero(np.abs(np.frombuffer(block, dtype='<i2').astype('int32')) > 32))

    capture_task = asyncio.create_task(capture())

    def delivered(chars: int) -> None:
        reports.append({'chars': chars, 'elapsed_ms': round((time.monotonic() - started) * 1000),
                        'active_audio_ms': round(active_samples * 1000 / RATE)})
        snapshots.append((chars, bytes(captured)))
        target = int(mode.split('-')[-1]) if mode.startswith('at-report-') else PREFIXES[0]
        if chars == target:
            reached.set()

    try:
        spawn = asyncio.create_subprocess_exec

        async def seeded_worker(*args, **kwargs):
            return await spawn(sys.executable, str(Path(__file__).resolve()), '--worker',
                               *(['--inject-premature-report'] if '--inject-premature-report' in sys.argv else []), **kwargs)

        with patch('asyncio.create_subprocess_exec', side_effect=seeded_worker):
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

            else:
                if mode.startswith('at-report-'):
                    await asyncio.wait_for(reached.wait(), 15)
                elif mode == 'during-first':
                    await asyncio.sleep(.7)
                elif mode == 'during-second':
                    await asyncio.wait_for(reached.wait(), 15)
                    await asyncio.sleep(.7)
                else:
                    # Use measured real baseline, not text length or generated token timing.
                    await asyncio.sleep((baseline_ms - 350) / 1000)
                result = await output.run({'type': 'cancel', 'operation_id': 'cancel', 'target_operation_id': 'reply'})
                await playing
                count = result['delivered_chars']
                expected = int(mode.split('-')[-1]) if mode.startswith('at-report-') else {'during-first': 0, 'during-second': 27, 'near-completion': 52}[mode]
                assert count == expected, (mode, count, reports)
                await asyncio.sleep(.15)  # collect the already submitted server tail
                measured = active_samples * 1000 / RATE
                assert measured > 100, 'interruption must contain real audio'
                consumed = await output.run({'type': 'cancel', 'operation_id': 'late-cancel', 'target_operation_id': 'reply'})
                assert consumed['delivered_chars'] == 0
        # Validate immutable event-time snapshots, never later audio or a baseline
        # indexed by the report under test. Immediate cancellation trials ensure
        # queued tails cannot rescue an early claim.
        for chars, snapshot in snapshots:
            assert chars in PREFIXES, 'unexpected delivery offset'
            verify_prefix(snapshot, reference[:PREFIXES.index(chars) + 1], RATE)
        elapsed_ms = round((time.monotonic() - started) * 1000)
        print(json.dumps({'trial': mode, 'result': result, 'delivery_reports': reports,
                          'active_audio_ms': round(active_samples * 1000 / RATE),
                          'elapsed_ms': elapsed_ms}), flush=True)
        return elapsed_ms
    finally:
        await output.stop()
        if recorder.returncode is None:
            recorder.terminate()
        capture_task.cancel()
        await asyncio.gather(capture_task, return_exceptions=True)
        await recorder.communicate()


async def check(model: str, device: str) -> None:
    reference = reference_pcm(str(Path(model).resolve()))
    print(json.dumps({'reference_sample_counts': [len(pcm) // 2 for pcm in reference], 'seed': SEED}), flush=True)
    baseline_ms = await trial(model, device, 'full', 0, reference)
    for mode in ('before-output', 'during-first', 'during-second', 'near-completion',
                 'at-report-27', 'at-report-52', 'at-report-76'):
        await trial(model, device, mode, baseline_ms, reference)


def worker() -> None:
    import onnxruntime as ort
    ort.disable_telemetry_events()
    ort.set_seed(SEED)
    import apps.audio.output_worker as runtime

    if '--inject-premature-report' in sys.argv:
        # Negative control: falsely claim the second sentence after 900 ms,
        # without changing any synthesis, playback or drain behavior.
        import threading
        original_emit = runtime.emit
        started_sentences = 0

        def premature(event: str, **values) -> None:
            nonlocal started_sentences
            if event == 'playback_started':
                started_sentences += 1
                if started_sentences == 2:
                    timer = threading.Timer(.9, lambda: original_emit('playback_delivered', delivered_chars=52))
                    timer.daemon = True
                    timer.start()
            if event == 'playback_delivered' and values.get('delivered_chars') == 52:
                return
            original_emit(event, **values)

        runtime.emit = premature
    runtime.main()


if __name__ == '__main__':
    if '--worker' in sys.argv:
        worker()
        raise SystemExit(0)
    device = 'jarvis_delivery_validation'
    module = subprocess.check_output(['pactl', 'load-module', 'module-null-sink',
                                      f'sink_name={device}', f'rate={RATE}'], text=True).strip()
    try:
        asyncio.run(check(sys.argv[1], device))
    finally:
        subprocess.run(['pactl', 'unload-module', module], check=True)
