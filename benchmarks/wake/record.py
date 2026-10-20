"""Explicit, local headset calibration recordings; Enter starts each bounded clip.

This is a calibration session, not the held-out acoustic acceptance protocol.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import select
import subprocess
import time
from typing import Any
import wave

from benchmarks.wake.evaluate import digest
from benchmarks.wake.prepare import QUESTIONS


def source_ready(name: str) -> dict[str, Any]:
    sources = json.loads(subprocess.check_output(
        ['pactl', '--format=json', 'list', 'sources'], timeout=1))
    source = next((s for s in sources if s['name'] == name), None)
    if (source is None or name == 'default' or name.endswith('.monitor')
            or source.get('monitor_of_sink_name') or source['mute']):
        raise ValueError('physical_unmuted_source_required')
    commands = [
        ['busctl', '--user', 'call', 'org.freedesktop.ScreenSaver', '/ScreenSaver',
         'org.freedesktop.ScreenSaver', 'GetActive'],
        ['busctl', '--system', 'get-property', 'org.freedesktop.login1',
         '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'PreparingForSleep'],
    ]
    for command in commands:
        if subprocess.check_output(command, timeout=1).strip() != b'b false':
            raise ValueError('desktop_inhibited_or_unknown')
    return dict(source)


def record(name: str) -> bytes:
    source = source_ready(name)
    capture = subprocess.Popen([
        'pw-record', '--target', source['properties']['node.name'], '--rate', '16000',
        '--channels', '1', '--format', 's16', '--raw',
        '--properties', '{ node.dont-fallback=true node.dont-reconnect=true node.dont-move=true }',
        '-',
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    pcm = bytearray()
    started = time.monotonic()
    checked = started
    try:
        assert capture.stdout
        while len(pcm) < 8 * 32000:
            now = time.monotonic()
            if now - started > 12:
                raise ValueError('recording_timeout')
            if now - checked >= .25:
                current = source_ready(name)
                if current['index'] != source['index']:
                    raise ValueError('source_changed')
                checked = time.monotonic()
            if not select.select([capture.stdout], [], [], .05)[0]:
                continue
            block = os.read(capture.stdout.fileno(), min(4096, 8 * 32000 - len(pcm)))
            if not block:
                raise ValueError('capture_disconnected')
            pcm.extend(block)
        source_ready(name)
        return bytes(pcm)
    finally:
        capture.kill()
        capture.wait()
        if capture.stdout:
            capture.stdout.close()
        pcm.clear()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='explicit stable physical source name')
    parser.add_argument('--directory', required=True, type=Path,
                        help='new private local directory; existing paths are rejected')
    args = parser.parse_args()
    os.umask(0o077)
    source = source_ready(args.source)
    args.directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest: dict[str, Any] = {'kind': 'human-headset-calibration',
                              'source': args.source, 'source_index': source['index'],
                              'run_completed': False, 'trials': []}
    path = args.directory / 'manifest.json'
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    print('20 clips, 8 seconds each. Enter starts capture; Ctrl-C aborts.')
    print('Wait one second after RECORDING, then speak normally. Stay silent after the phrase.')
    print('Files stay local until you delete the chosen directory. No service setting is changed.')
    for intended in (True, False):
        for number, question in enumerate(QUESTIONS):
            identifier = f'{"positive" if intended else "negative"}-{number:02}'
            prefix = 'Hey Jarvis, ' if intended else ('Hey Jasper, ' if number % 2 else 'Hey Travis, ')
            input(f'\n{identifier}: {prefix}{question}\nPress Enter when ready: ')
            print('RECORDING — 8 seconds', flush=True)
            pcm = record(args.source)
            target = args.directory / f'{identifier}.wav'
            with wave.open(str(target), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(pcm)
            del pcm
            row: dict[str, Any] = {'id': identifier, 'condition': 'headset-quiet-calibration',
                                   'intended_wake': intended, 'path': target.name,
                                   'sha256': digest(target)}
            if intended:
                row['wake_window_ms'] = [1000, 8000]
            manifest['trials'].append(row)
            path.write_text(json.dumps(manifest, indent=2) + '\n')
            print('Saved. Capture stopped.', flush=True)
    manifest['run_completed'] = True
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    print('Calibration recordings complete. Evaluate this manifest; keep acceptance recordings separate.')


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('recording_stopped') from None
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('recording_failed_or_privacy_inhibited') from None
