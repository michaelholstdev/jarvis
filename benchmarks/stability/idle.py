"""Measure isolated idle services; default duration is two real hours.

No device capture or desktop changes. Pass --config for resident voice models.
Logs are drained to counters, never retained. Queue/buffer internals are unvalidated.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Awaitable

from apps.audio.main import load_config
from benchmarks.latency.resources import snapshot, process_tree


def cumulative_cpu(pids: list[int]) -> float:
    """Include reaped-child ticks so worker exit cannot erase consumed CPU.

    Five-second polling cannot resolve each worker's instantaneous CPU or peak RSS.
    """
    ticks = 0
    for root in pids:
        for pid in process_tree(root):
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            ticks += sum(int(v) for v in fields[11:15])
    return ticks / os.sysconf('SC_CLK_TCK')


async def seed_voice(config: dict[str, Any], request: Callable[..., Awaitable[dict[str, Any]]]) -> None:
    """Feed synthetic speech only to an explicitly selected silent monitor source."""
    import numpy as np
    from piper import PiperVoice
    import soxr
    source = config['audio']['input_device']
    if not source.startswith('jarvis_stability_') or not source.endswith('.monitor'):
        raise ValueError('voice soak requires a private jarvis_stability_* monitor source')
    voice = PiperVoice.load(config['tts']['model_path'], use_cuda=False)
    pcm = np.concatenate([c.audio_float_array for c in voice.synthesize('Was ist ein Computer?')])
    pcm = soxr.resample(pcm, voice.config.sample_rate, 48000)
    pcm = np.concatenate([np.zeros(24000), pcm, np.zeros(48000)])
    del voice
    await request('activate')
    deadline = time.monotonic() + 180
    while (await request('hello', role='cli'))['status']['state'] != 'listening':
        if time.monotonic() > deadline:
            raise RuntimeError('seed_listening_timeout')
        await asyncio.sleep(.05)
    feeder = await asyncio.create_subprocess_exec('pw-play', '--target', source.removesuffix('.monitor'),
               '--rate', '48000', '--channels', '1', '--format', 's16', '--raw', '-',
               stdin=-1, stdout=-3, stderr=-3)
    try:
        await asyncio.wait_for(feeder.communicate((pcm * 32767).astype('<i2').tobytes()), 20)
        if feeder.returncode:
            raise RuntimeError('seed_feed_failed')
    finally:
        if feeder.returncode is None:
            feeder.kill()
            await feeder.wait()
    while (await request('hello', role='cli'))['status']['state'] != 'follow-up':
        if time.monotonic() > deadline:
            raise RuntimeError('seed_answer_timeout')
        await asyncio.sleep(.05)


async def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.config:
        # Use the same validated configuration reader as production.
        old = os.environ.get('JARVIS_CONFIG')
        os.environ['JARVIS_CONFIG'] = str(args.config.resolve())
        try:
            config = load_config()
        finally:
            if old is None:
                os.environ.pop('JARVIS_CONFIG', None)
            else:
                os.environ['JARVIS_CONFIG'] = old
    else:
        config = json.loads(Path('config/defaults.json').read_text())
    children: list[asyncio.subprocess.Process] = []
    tasks: list[asyncio.Task[None]] = []
    counters = {'bytes': 0, 'lines': 0, 'operations': 0, 'non_json': 0, 'sentinel_leaks': 0}
    samples: list[dict[str, Any]] = []
    started_utc = datetime.now(timezone.utc).isoformat()
    checks: dict[str, str] = {}
    sentinel = 'computer' if config['audio']['mode'] == 'voice' else 'stability privacy sentinel'

    async def drain(stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            counters['bytes'] += len(line)
            counters['lines'] += 1
            counters['sentinel_leaks'] += int(sentinel.encode() in line.lower())
            try:
                event = json.loads(line)
                if event.get('event') in {'operation_started', 'llm_first_token', 'recognition_final'}:
                    counters['operations'] += 1
            except (ValueError, AttributeError):
                counters['non_json'] += 1

    with tempfile.TemporaryDirectory(prefix='jv-soak-') as directory:
        runtime = Path(directory)
        path = runtime / 'config.json'
        path.write_text(json.dumps(config))
        env = {**os.environ, 'XDG_RUNTIME_DIR': directory, 'JARVIS_CONFIG': str(path),
               'PULSE_SERVER': os.environ.get('PULSE_SERVER',
                   f"unix:{os.environ.get('XDG_RUNTIME_DIR', '/nonexistent')}/pulse/native"),
               'PIPEWIRE_RUNTIME_DIR': os.environ.get('XDG_RUNTIME_DIR', '/nonexistent')}

        async def request(kind: str, **fields: Any) -> dict[str, Any]:
            reader, writer = await asyncio.open_unix_connection(str(runtime / 'jarvis/core.sock'))
            try:
                writer.write((json.dumps({'version': 1, 'type': kind, **fields}) + '\n').encode())
                await writer.drain()
                response = json.loads(await asyncio.wait_for(reader.readline(), 360 if kind == 'demo' else 10))
                if response['type'] == 'error':
                    raise RuntimeError('acceptance_request_failed')
                return dict(response)
            finally:
                writer.close()
                await writer.wait_closed()

        try:
            for cmd in ((sys.executable, 'apps/audio/main.py'), ('node', 'dist/apps/core/main.js', 'start')):
                child = await asyncio.create_subprocess_exec(*cmd, env=env, stdout=-1, stderr=-1)
                children.append(child)
                assert child.stdout and child.stderr
                tasks.append(asyncio.create_task(drain(child.stderr)))
                line = await asyncio.wait_for(child.stdout.readline(), 60)
                if json.loads(line).get('event') != 'service_started':
                    raise RuntimeError('acceptance_startup_failed')
                tasks.append(asyncio.create_task(drain(child.stdout)))
            # Seed and explicitly close a conversation before measuring idle.
            if config['audio']['mode'] == 'voice':
                await seed_voice(config, request)
                seed = await request('hello', role='cli')
            else:
                seed = await request('demo', text=sentinel)
            seed_text = await request('text-answer-request', offset=0)
            if seed['status']['last_failure'] or not seed_text.get('text'):
                raise RuntimeError('acceptance_seed_turn_failed')
            if config['audio']['mode'] == 'voice':
                await request('inhibition-changed', source='muted', active=True)
                await request('inhibition-changed', source='muted', active=False)
            else:
                await request('demo', text='Gespräch beenden')
            del seed_text, seed
            await asyncio.sleep(.2)
            baseline = dict(counters)
            start = time.monotonic()
            healthy = True
            while True:
                if any(c.returncode is not None for c in children) or any(t.done() for t in tasks):
                    raise RuntimeError('acceptance_service_or_collector_exited')
                health = (await request('hello', role='cli'))['status']
                text = await request('text-answer-request', offset=0)
                healthy &= health['state'] == 'idle' and health['ready'] and text.get('text') is None
                rows = [snapshot(c.pid) for c in children]
                samples.append({'elapsed_seconds': time.monotonic() - start,
                                'rss_bytes': sum(r['rss_bytes'] for r in rows),
                                'cpu_seconds': cumulative_cpu([c.pid for c in children]),
                                'processes': sum(r['processes'] for r in rows),
                                'log_bytes': counters['bytes'] - baseline['bytes']})
                if len(samples) == 1 or samples[-1]['elapsed_seconds'] // 60 > samples[-2]['elapsed_seconds'] // 60:
                    print(json.dumps({'elapsed_seconds': samples[-1]['elapsed_seconds'],
                                      'rss_bytes': samples[-1]['rss_bytes'],
                                      'idle_log_bytes': samples[-1]['log_bytes']}), flush=True)
                if samples[-1]['elapsed_seconds'] >= args.seconds:
                    break
                await asyncio.sleep(min(args.interval, args.seconds - samples[-1]['elapsed_seconds']))
            # Freeze counters/samples before cleanup; collector failure is fatal.
            await asyncio.sleep(0)
            if any(t.done() for t in tasks):
                raise RuntimeError('acceptance_collector_exited')
            elapsed = samples[-1]['elapsed_seconds']
            cpu_valid = all(b['cpu_seconds'] >= a['cpu_seconds'] for a, b in zip(samples, samples[1:]))
            cpu = sum(max(0, b['cpu_seconds'] - a['cpu_seconds'])
                      for a, b in zip(samples, samples[1:])) / elapsed * 100
            growth = samples[-1]['rss_bytes'] - samples[0]['rss_bytes']
            idle_logs = counters['bytes'] - baseline['bytes']
            checks = {'two_hour_duration': 'passed' if elapsed >= 7200 else 'unvalidated',
                      'idle_state_and_text_cleared': 'passed' if healthy else 'failed',
                      'idle_operations': 'passed' if counters['operations'] == baseline['operations'] else 'failed',
                      'sentinel_absent_from_logs': 'passed' if not counters['sentinel_leaks'] else 'failed',
                      'structured_logs': 'passed' if not counters['non_json'] else 'failed',
                      'resource_screen': ('unvalidated' if elapsed < 60 or not cpu_valid else
                                          'passed' if cpu <= 5 and growth <= 32 * 1024**2 else 'failed'),
                      'log_growth_screen': 'passed' if idle_logs <= 1024 * (1 + elapsed / 60) else 'failed',
                      'queues_and_audio_buffers': 'unvalidated',
                      'physical_devices': 'unvalidated'}
            report = {'started_utc': started_utc, 'elapsed_seconds': elapsed,
                      'requested_seconds': args.seconds, 'interval_seconds': args.interval,
                      'mode': config['audio']['mode'], 'llm_mode': config['llm']['mode'],
                      'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                      'environment': {'kernel': platform.release(), 'python': platform.python_version(),
                                      'node': subprocess.check_output(['node', '--version'], text=True).strip()},
                      'config_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                      'thresholds': {'cpu_percent_one_core_max': 5, 'rss_growth_bytes_max': 32 * 1024**2,
                                     'log_bytes_per_minute_max': 1024, 'log_startup_allowance_bytes': 1024},
                      'cpu_percent_one_core': cpu, 'rss_growth_bytes': growth,
                      'rss_peak_bytes': max(r['rss_bytes'] for r in samples),
                      'idle_log_bytes': idle_logs, 'checks': checks, 'samples': samples}
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for child in reversed(children):
                if child.returncode is None:
                    child.terminate()
                try:
                    await asyncio.wait_for(child.wait(), 5)
                except asyncio.TimeoutError:
                    child.kill()
                    await child.wait()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=float, default=7200)
    parser.add_argument('--interval', type=float, default=5)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not all(math.isfinite(v) and v > 0 for v in (args.seconds, args.interval)):
        parser.error('seconds and interval must be finite and positive')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    initial = {'run_completed': False, 'started_utc': started, 'checks': {'execution': 'running'}}
    args.output.write_text(json.dumps(initial, indent=2) + '\n')
    try:
        report = {'run_completed': True, **asyncio.run(run(args))}
    except Exception as error:
        failure = {**initial, 'checks': {'execution': 'failed'}, 'error_type': type(error).__name__}
        args.output.write_text(json.dumps(failure, indent=2) + '\n')
        print(json.dumps(failure), flush=True)
        raise SystemExit(1) from None
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'samples'}), flush=True)
    if 'failed' in report['checks'].values():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
