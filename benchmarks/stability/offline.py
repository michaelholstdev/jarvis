"""Run inside a disposable network namespace containing only loopback.

Uses preinstalled models and private silent sinks; never downloads models.
Physical devices, desktop actions and acoustic stop remain unvalidated.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Any

from benchmarks.latency.run import ollama


def run(args: argparse.Namespace) -> dict[str, Any]:
    interfaces = sorted(line.split(':', 1)[0].strip()
                        for line in Path('/proc/net/dev').read_text().splitlines()[2:])
    routes = Path('/proc/net/route').read_text().splitlines()[1:]
    ipv6 = Path('/proc/net/ipv6_route').read_text().splitlines()
    if interfaces != ['lo'] or routes or any(line.split()[-1] != 'lo' for line in ipv6):
        raise SystemExit('Requires a network namespace with only loopback and no external routes')
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='jv-offline-') as directory:
        store = Path(directory) / 'models'
        shutil.copytree(args.model_store / 'manifests', store / 'manifests')
        (store / 'blobs').mkdir()
        for blob in (args.model_store / 'blobs').iterdir():
            (store / 'blobs' / blob.name).symlink_to(blob.resolve())
        env = {**os.environ, 'HOME': directory, 'OLLAMA_HOST': '127.0.0.1:11434',
               'OLLAMA_MODELS': str(store), 'OLLAMA_NUM_PARALLEL': '1',
               'OLLAMA_NOPRUNE': '1', 'OLLAMA_NO_CLOUD': '1'}
        server = subprocess.Popen(['ollama', 'serve'], env=env, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    models = ollama('tags')['models']
                    break
                except OSError:
                    if server.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('isolated_ollama_unavailable') from None
                    time.sleep(.1)
            model = next((m for m in models if m['name'] == args.model), None)
            if model is None:
                raise RuntimeError('local_model_missing_no_download')
            commands = [
                ['node', '--test', 'dist/tests/extension-runtime.test.js',
                 'dist/tests/text-answer-cli.test.js', 'dist/tests/privacy-runtime.test.js',
                 'dist/tests/recovery-runtime.test.js', 'dist/tests/ollama-daemon.test.js',
                 'dist/tests/delivered-context.test.js', 'dist/tests/desktop-runtime.test.js'],
                [sys.executable, '-m', 'benchmarks.latency.run', '--model', args.model,
                 '--voice', 'models/benchmark/de_DE-thorsten-medium.onnx',
                 '--input-dir', 'models/input', '--samples', '30',
                 '--output', str(args.output / 'voice.json')],
            ]
            for command in commands:
                start = time.monotonic()
                result = subprocess.run(command, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, timeout=600)
                results.append({'command': command, 'exit_code': result.returncode,
                                'elapsed_seconds': time.monotonic() - start})
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    voice = json.loads((args.output / 'voice.json').read_text())
    voice_ok = (results[-1]['exit_code'] == 0 and voice.get('run_completed') is True and voice.get('expected_attempts') == 30
                and voice.get('summary', {}).get('completed') == 30
                and 'signal_start_ms' in voice.get('initial_trial', {}))
    report = {'run_completed': True, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
              'interfaces': interfaces, 'external_ipv4_routes': routes,
              'external_ipv6_routes': [], 'model': model,
              'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'results': results,
              'checks': {'local_voice_turns': 'passed' if voice_ok else 'failed',
                         'control_suites': 'passed' if results[0]['exit_code'] == 0 else 'failed'},
              'scope': 'isolated network; actual synthetic voice path plus separate mock control suites',
              'unvalidated': ['physical devices', 'desktop suspend/lock', 'acoustic spoken stop',
                              'human German usefulness', 'two-hour idle', 'external syscall audit']}
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--model-store', type=Path, default=Path('/var/lib/ollama'))
    parser.add_argument('--model', default='gemma3:270m')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / 'offline.json'
    initial = {'run_completed': False, 'started_utc': datetime.now(timezone.utc).isoformat(),
               'checks': {'execution': 'running'}}
    output.write_text(json.dumps(initial, indent=2) + '\n')
    (args.output / 'voice.json').write_text(json.dumps({'run_completed': False}) + '\n')
    try:
        report = run(args)
    except (Exception, SystemExit) as error:
        report = {**initial, 'checks': {'execution': 'failed'}, 'error_type': type(error).__name__}
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    if not report['run_completed'] or 'failed' in report['checks'].values():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
