"""Opt-in acoustic trial on configured physical devices; records no microphone audio."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.main import load_config  # noqa: E402
from apps.audio.output import Output, verify_voice  # noqa: E402


async def trial(args: argparse.Namespace) -> None:
    config = load_config()
    if config['audio']['mode'] != 'voice' or not config['features']['voice_stop']:
        raise SystemExit('Requires audio.mode: voice and features.voice_stop: true')
    path = Path(__file__).resolve().parents[1] / 'tests/fixtures/spoken-stop/cases.json'
    case = json.loads(path.read_text())[args.case]
    print(case['instruction'], flush=True)
    verify_voice(config)
    output = Output(config)
    detected = asyncio.Event()
    detection_ms = None
    started = 0.

    def control() -> None:
        nonlocal detection_ms
        detection_ms = round((time.monotonic() - started) * 1000)
        detected.set()

    async def cue() -> None:
        await asyncio.sleep(5)
        if args.case == 'positive':
            print('SAY STOPP NOW (cue is not a measured speech onset)', flush=True)

    try:
        await output.run({'type': 'synthesize', 'operation_id': 'fixture', 'text': case['reply']})
        started = time.monotonic()
        print(json.dumps({'event': 'trial_start', 'monotonic_seconds': started}), flush=True)
        playback = asyncio.create_task(output.run({'type': 'play', 'operation_id': 'trial', 'text': case['reply']}, on_control=control))
        stop = asyncio.create_task(detected.wait())
        prompt = asyncio.create_task(cue())
        try:
            await asyncio.wait({playback, stop}, return_when=asyncio.FIRST_COMPLETED)
            if detected.is_set():
                await output.run({'type': 'cancel', 'operation_id': 'stop', 'target_operation_id': 'trial'})
            await playback
        finally:
            prompt.cancel()
            stop.cancel()
            await asyncio.gather(prompt, stop, return_exceptions=True)
        elapsed = round((time.monotonic() - started) * 1000)
        # External onset annotation must use the trial_start clock; the cue is
        # deliberately never substituted for the actual user's speech onset.
        print(json.dumps({
            'setup': args.setup, 'case': args.case, 'detected': detected.is_set(),
            'detection_ms': detection_ms, 'trial_ms': elapsed,
            'speech_onset_ms': args.onset_ms,
            'response_delay_ms': detection_ms - args.onset_ms if detection_ms is not None and args.onset_ms is not None else None,
            'fr09': 'unvalidated',
            'fixture_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'settings': {'input': config['audio']['input_device'], 'output': config['audio']['output_device'],
                         'end_silence_ms': config['vad']['end_silence_ms'], 'echo_threshold': .35},
        }), flush=True)
    finally:
        await output.stop()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--setup', choices=['headset', 'speakers'], required=True)
parser.add_argument('--case', choices=['positive', 'assistant-stop', 'background'], required=True)
parser.add_argument('--onset-ms', type=float, help='externally measured speech onset relative to trial_start; never use cue time')
asyncio.run(trial(parser.parse_args()))
