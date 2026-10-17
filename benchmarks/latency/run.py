"""Opt-in actual voice-path benchmark on two private silent PipeWire sinks.

No physical capture, downloads, global device changes or conversation persistence.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

from apps.audio.input import verify_input
from apps.audio.main import load_config
from apps.audio.output import verify_voice
from benchmarks.latency.report import summarize
from benchmarks.latency.resources import snapshot, summarize_resources
from benchmarks.recognition.prepare import digest, write_json
from benchmarks.recognition.run import hardware

HERE = Path(__file__).parent
RATE = 48000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        raise ValueError('ollama_redirect_disabled')


def ollama(path: str) -> dict[str, Any]:
    # Fixed loopback, no proxy, redirects or content-bearing requests.
    with build_opener(ProxyHandler({}), NoRedirect()).open('http://127.0.0.1:11434/api/' + path, timeout=5) as response:
        return dict(json.load(response))


async def command(*args: str) -> str:
    child = await asyncio.create_subprocess_exec(*args, stdout=-1, stderr=-3)
    output, _ = await asyncio.wait_for(child.communicate(), 10)
    if child.returncode:
        raise RuntimeError('audio_command_failed')
    return output.decode().strip()


async def run(args: argparse.Namespace) -> None:
    import numpy as np
    from piper import PiperVoice
    import soxr
    config = load_config()
    name = f'jarvis_bench_{os.getpid()}'
    config['audio'].update(mode='voice', input_device=name + '_in.monitor', output_device=name + '_out')
    config['tts']['model_path'] = str(args.voice.resolve())
    config['stt']['model_dir'] = str(args.input_dir.resolve())
    config['llm'].update(mode='ollama', base_url='http://127.0.0.1:11434', model=args.model,
                         num_predict=args.num_predict, max_context_tokens=args.context,
                         temperature=0, seed=42, timeout_ms=120000)
    config['features']['voice_stop'] = False
    config['vad']['max_utterance_seconds'] = 12
    config['session'].update(follow_up_seconds=60, max_duration_seconds=3600)
    verify_voice(config)
    verify_input(config)
    selected = next((m for m in ollama('tags')['models'] if m['name'] == args.model), None)
    if selected is None:
        raise ValueError('Requested local model not installed; no automatic download')
    cases = json.loads((HERE / 'cases.json').read_text())
    speaker = PiperVoice.load(str(args.voice), use_cuda=False)
    fixtures = []
    for case in cases:
        samples = np.concatenate([c.audio_float_array for c in speaker.synthesize(case['question'])])
        samples = soxr.resample(samples, speaker.config.sample_rate, RATE)
        samples = np.concatenate([np.zeros(RATE // 2), samples, np.zeros(RATE)])
        fixtures.append((samples * 32767).astype('<i2').tobytes())
    del speaker
    before = hardware()
    loaded_before = ollama('ps')
    modules: list[str] = []
    children: list[asyncio.subprocess.Process] = []
    readers: list[asyncio.Task[None]] = []
    events: list[dict[str, Any]] = []
    trials: list[dict[str, Any]] = []
    phase = 'idle'
    phases: dict[str, list[dict[str, Any]]] = {'idle': [], 'active': []}
    report: dict[str, Any] = {}

    async def consume(stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            event = json.loads(line)
            # Explicit field allowlist: never retain unexpected diagnostic content.
            if event.get('event') in {'operation_started', 'llm_first_token', 'endpoint',
                                      'recognition_final', 'tts_first_audio', 'playback_started',
                                      'playback_completed', 'interruption', 'speech_started'}:
                events.append({k: event[k] for k in ('event', 'operation', 'operation_id',
                              'turn_id', 'target_operation_id', 'monotonic_ms') if k in event})
                if len(events) > 20000:
                    raise RuntimeError('event_budget_exceeded')

    async def request(kind: str, **fields: Any) -> dict[str, Any]:
        reader, writer = await asyncio.open_unix_connection(str(runtime / 'jarvis/core.sock'))
        try:
            writer.write((json.dumps({'version': 1, 'type': kind, **fields}) + '\n').encode())
            await writer.drain()
            result = json.loads(await asyncio.wait_for(reader.readline(), 10))
            if result['type'] == 'error':
                raise RuntimeError('core_request_failed')
            return dict(result)
        finally:
            writer.close()
            await writer.wait_closed()

    async def health() -> dict[str, Any]:
        return dict((await request('hello', role='cli'))['status'])

    async def sample() -> None:
        while True:
            row = snapshot(children[0].pid)
            phases[phase].append(row)
            await asyncio.sleep(.1)

    async def trial(index: int) -> dict[str, Any]:
        # Use natural follow-ups so the worker and inference models remain resident.
        start_event = len(events)
        if (await health())['state'] == 'idle':
            await request('activate')
        deadline = time.monotonic() + 150
        while (await health())['state'] not in {'listening', 'follow-up'}:
            if time.monotonic() > deadline:
                raise RuntimeError('listening_timeout')
            await asyncio.sleep(.02)
        monitors = []
        tasks = []
        observed: dict[str, list[float]] = {'in': [], 'out': []}

        async def monitor(which: str) -> None:
            recorder = await asyncio.create_subprocess_exec(
                'parec', '--raw', '--format=s16le', f'--rate={RATE}', '--channels=1',
                '--latency-msec=10', f'--device={name}_{which}.monitor', stdout=-1, stderr=-3)
            monitors.append(recorder)
            assert recorder.stdout
            while True:
                block = await recorder.stdout.readexactly(960)  # 10 ms
                if np.any(np.abs(np.frombuffer(block, dtype='<i2').astype('int32')) > 32):
                    observed[which].append(time.monotonic_ns() / 1e6)

        try:
            tasks = [asyncio.create_task(monitor(which)) for which in ('in', 'out')]
            await asyncio.sleep(.15)
            feeder = await asyncio.create_subprocess_exec(
                'pw-play', '--target', name + '_in', '--rate', str(RATE), '--channels', '1',
                '--format', 's16', '--raw', '-', stdin=-1, stdout=-3, stderr=-3)
            try:
                await asyncio.wait_for(feeder.communicate(fixtures[index % len(fixtures)]), 20)
            finally:
                if feeder.returncode is None:
                    feeder.kill()
                    await feeder.wait()
            while True:
                status = await health()
                # Audio worker has already drained full reply when core enters follow-up.
                if status['state'] == 'follow-up':
                    break
                if status['last_failure'] or time.monotonic() > deadline:
                    return {'case_id': cases[index % len(cases)]['id'], 'error': 'turn_failed',
                            'events': events[start_event:]}
                await asyncio.sleep(.025)
            # Text is temporary and used only for the fixed screening checks, never saved.
            text = (await request('text-answer-request')).get('text') or ''
            matched = all(re.search(pattern, text.casefold()) for pattern in cases[index % len(cases)]['required'])
            row = {'case_id': cases[index % len(cases)]['id'], 'usefulness_screen': bool(matched),
                   'events': events[start_event:]}
            if observed['in'] and observed['out']:
                row.update(speech_end_ms=observed['in'][-1], signal_start_ms=observed['out'][0])
            else:
                row['error'] = 'missing_monitor_signal'
            return row
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for recorder in monitors:
                if recorder.returncode is None:
                    recorder.terminate()
                await recorder.wait()

    try:
        for side in ('in', 'out'):
            modules.append(await command('pactl', 'load-module', 'module-null-sink',
                                         f'sink_name={name}_{side}', f'rate={RATE}'))
        with tempfile.TemporaryDirectory(prefix='jv-bench-') as directory:
            runtime = Path(directory)
            path = runtime / 'config.json'
            path.write_text(json.dumps(config))
            env = {**os.environ, 'PULSE_SERVER': os.environ.get('PULSE_SERVER',
                   f"unix:{os.environ['XDG_RUNTIME_DIR']}/pulse/native"),
                   'PIPEWIRE_RUNTIME_DIR': os.environ['XDG_RUNTIME_DIR'],
                   'XDG_RUNTIME_DIR': directory, 'JARVIS_CONFIG': str(path)}
            for cmd in ((sys.executable, 'apps/audio/main.py'), ('node', 'dist/apps/core/main.js', 'start')):
                child = await asyncio.create_subprocess_exec(*cmd, env=env, stdout=-1, stderr=-1)
                children.append(child)
                assert child.stdout and child.stderr
                while True:
                    line = await asyncio.wait_for(child.stdout.readline(), 40)
                    if not line:
                        raise RuntimeError('service_start_failed')
                    if json.loads(line).get('event') == 'service_started':
                        break
                readers.extend([asyncio.create_task(consume(child.stdout)), asyncio.create_task(consume(child.stderr))])
            sampling = asyncio.create_task(sample())
            readers.append(sampling)
            await asyncio.sleep(3)
            phase = 'active'
            # One separately reported initial query warms Ollama and the actual speech path.
            cold = await trial(0)
            loaded_warm = ollama('ps')
            # Natural follow-ups retain bounded delivered conversation context.
            for index in range(args.samples):
                row = await trial(index)
                trials.append(row)
                write_json(args.output, {'run_completed': False, 'expected_attempts': args.samples,
                                         'model': selected, 'initial_trial': cold, 'trials': trials,
                                         'summary': {**summarize(trials), 'proxy_target': 'unvalidated'}})
                print(json.dumps({'sample': index + 1, 'completed': 'signal_start_ms' in row}), flush=True)
            phase = 'idle'
            await request('inhibition-changed', source='muted', active=True)
            report = {'run_completed': True, 'expected_attempts': args.samples,
                      'timestamp_utc': datetime.now(timezone.utc).isoformat(),
                      'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                      'measurement': 'silent_sink_signal_proxy_not_physical_audibility',
                      'scenario': {'warm': True, 'length': 'short', 'noise': 'synthetic_quiet',
                                   'device': 'two_silent_pipewire_sinks', 'tools': False,
                                   'history': 'bounded_delivered_follow_up_context', 'wake': 'unavailable'},
                      'config': {k: config[k] for k in ('audio', 'stt', 'tts', 'vad', 'llm', 'features', 'interaction', 'session')},
                      'model': selected, 'speech_models': json.loads(Path('config/models.json').read_text()),
                      'runtimes': {p: version(p) for p in ('sherpa-onnx', 'sherpa-onnx-core', 'piper-tts', 'soxr', 'numpy')},
                      'uv_lock_sha256': digest(Path('uv.lock')), 'cases_sha256': digest(HERE / 'cases.json'),
                      'hardware_before': before, 'hardware_after': hardware(),
                      'ollama_version': ollama('version'), 'ollama_before': loaded_before,
                      'ollama_warm': loaded_warm, 'ollama_after': ollama('ps'),
                      'initial_trial': cold, 'trials': trials, 'summary': summarize(trials),
                      'resources': {k: summarize_resources(v) for k, v in phases.items()},
                      'resource_samples': phases,
                      'usefulness': {'method': 'fixed case required-word screen; no human judgment',
                                     'passed': sum(t.get('usefulness_screen', False) for t in trials),
                                     'attempts': len(trials), 'human_german_conversation': 'unvalidated'},
                      'unvalidated': ['physical audibility', 'headset', 'speaker', 'noisy', 'long',
                                      'concurrent STT/TTS', 'controlled cold/unloaded', 'wake']}
    finally:
        for child in reversed(children):
            if child.returncode is None:
                child.terminate()
            await child.wait()
        for reader in readers:
            reader.cancel()
        await asyncio.gather(*readers, return_exceptions=True)
        for module in reversed(modules):
            await command('pactl', 'unload-module', module)
    write_json(args.output, report)
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--voice', required=True, type=Path)
    parser.add_argument('--input-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--num-predict', type=int, default=64)
    parser.add_argument('--context', type=int, default=2048)
    args = parser.parse_args()
    if not 1 <= args.samples <= 100 or not 1 <= args.num_predict <= 2048 or not 512 <= args.context <= 32768:
        parser.error('samples 1..100, num-predict 1..2048, context 512..32768 required')
    asyncio.run(run(args))
