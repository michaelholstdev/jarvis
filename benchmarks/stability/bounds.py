"""Record existing public-contract checks without retaining their output.

Socket admission and frame limits are observed by regression tests. Native audio
buffer occupancy is not measured by these checks and cannot receive a pass.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import sys
import time
from typing import Any


def interrupted(signum: int, frame: Any) -> None:
    raise KeyboardInterrupt


def main() -> None:
    signal.signal(signal.SIGTERM, interrupted)
    report: dict[str, Any] = {
        'run_completed': False, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'checks': {'execution': 'failed', 'native_audio_buffer_occupancy': 'unvalidated'}}
    preliminary = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    preliminary.add_argument('--output', type=Path)
    destination, _ = preliminary.parse_known_args()
    if destination.output:
        destination.output.parent.mkdir(parents=True, exist_ok=True)
        destination.output.write_text(json.dumps(report, indent=2) + '\n')
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--occupancy-only', action='store_true',
                        help='skip historical contract suites, collecting only production occupancy')
    parser.add_argument('--fixture-service', type=Path, default=Path('tests/fixtures/wake/audio_service.py'))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    commands = [
        ['node', '--test', 'dist/tests/transport.test.js', 'dist/tests/transport-framing.test.js'],
        [sys.executable, '-m', 'unittest', 'tests.output_test', 'tests.long_speech_test'],
    ]
    try:
        if importlib.util.find_spec('numpy') is None:
            raise RuntimeError('waveform_dependency_missing')
        results = []
        for command in ([] if args.occupancy_only else commands):
            start = time.monotonic()
            result = subprocess.run(command, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=120, check=False)
            results.append({'command': command, 'exit_code': result.returncode,
                            'elapsed_seconds': time.monotonic() - start})
        paths = [*Path('apps/core').glob('*.ts'), *Path('apps/audio').glob('*.py'),
                 Path('config/defaults.json'), Path('packages/protocol/schemas/config.schema.json'),
                 Path('tests/transport.test.ts'), Path('tests/transport-framing.test.ts'),
                 Path('tests/output_test.py'), Path('tests/long_speech_test.py'),
                 Path('tests/fixtures/long-speech/worker.py')]
        paths.extend(Path('dist').rglob('*.js'))
        paths.extend(Path('benchmarks/stability').glob('*.py'))
        paths.extend([args.fixture_service, Path('tests/buffer_acceptance_test.py')])
        from benchmarks.stability.occupancy import collect
        occupancy = asyncio.run(asyncio.wait_for(collect(args.fixture_service), 25))
        checks = {'native_audio_buffer_occupancy': 'unvalidated',
                  'production_capture_payload_occupancy': occupancy['verdict']}
        if results:
            checks.update(socket_admission_and_frames='passed' if results[0]['exit_code'] == 0 else 'failed',
                          audio_cancellation_and_duration='passed' if results[1]['exit_code'] == 0 else 'failed')
        else:
            checks.update(socket_admission_and_frames='unvalidated', audio_cancellation_and_duration='unvalidated')
        report.update(
            run_completed=True, results=results,
            source_state='working tree identified by source_sha256; source_revision is its Git parent',
            fixture_service=str(args.fixture_service),
            source_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
            source_sha256={str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                           for path in sorted(paths)},
            checks=checks, occupancy=occupancy,
            scope='isolated production capture/socket path with deterministic external audio/model fixtures; no physical devices',
            unvalidated=occupancy['unvalidated'])
        if 'failed' in checks.values():
            report['run_completed'] = False
    except Exception as error:
        report['error_type'] = type(error).__name__
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'run_completed': report['run_completed'], 'checks': report['checks']}), flush=True)
    if not report['run_completed'] or 'failed' in report['checks'].values():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
