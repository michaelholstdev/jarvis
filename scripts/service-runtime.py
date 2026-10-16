"""Private XDG setup, stale-socket recovery and bounded unit readiness checks."""
from __future__ import annotations

import errno
import json
import os
from pathlib import Path
import socket
import stat
import sys
import time


def private_directory(path: Path) -> None:
    if not path.is_absolute():
        raise ValueError('unsafe_directory')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('unsafe_directory')


def runtime() -> Path:
    root = Path(os.environ.get('XDG_RUNTIME_DIR', ''))
    if not root.is_absolute() or not root.exists():
        raise ValueError('missing_runtime_directory')
    private_directory(root)
    directory = root / 'jarvis'
    private_directory(directory)
    return directory


def prepare(path: Path) -> None:
    for variable, fallback in [('XDG_CONFIG_HOME', '.config'), ('XDG_STATE_HOME', '.local/state')]:
        private_directory(Path(os.environ.get(variable, str(Path.home() / fallback))) / 'jarvis')
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError('unsafe_socket')
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(1)
        try:
            client.connect(str(path))
        except OSError as error:
            if error.errno != errno.ECONNREFUSED:
                raise ValueError('socket_unavailable') from None
        else:
            raise ValueError('socket_in_use')
    # Never remove a replacement created while checking the stale inode.
    if path.lstat().st_ino != info.st_ino:
        raise ValueError('socket_changed')
    path.unlink()


def wait_ready(path: Path, service: str) -> None:
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            with socket.socket(socket.AF_UNIX) as client:
                client.settimeout(2)
                client.connect(str(path))
                client.sendall(json.dumps({'version': 1, 'type': 'hello',
                                           'role': 'core' if service == 'audio' else 'cli'}).encode() + b'\n')
                data = bytearray()
                while b'\n' not in data and len(data) <= 8192:
                    block = client.recv(8192)
                    if not block:
                        break
                    data.extend(block)
                response = json.loads(data)
                if response.get('type') == 'ready' and response.get('service') == service:
                    if service == 'audio' or response.get('status', {}).get('ready'):
                        return
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    raise ValueError('readiness_timeout')


def main() -> None:
    os.umask(0o077)
    if len(sys.argv) != 3 or sys.argv[1] not in {'prepare', 'wait'} or sys.argv[2] not in {'core', 'audio'}:
        raise ValueError('usage')
    action, service = sys.argv[1:]
    path = runtime() / f'{service}.sock'
    if action == 'prepare':
        prepare(path)
    else:
        wait_ready(path, service)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError):
        print('{"event":"service_setup_failed"}', file=sys.stderr)
        raise SystemExit(1) from None
