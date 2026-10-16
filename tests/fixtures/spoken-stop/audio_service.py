"""Real audio service with deterministic model files and external worker boundary."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))


def worker() -> None:
    json.loads(sys.stdin.readline())
    print('{"event":"ready"}', flush=True)
    for line in sys.stdin:
        operation = json.loads(line)
        if operation['type'] == 'play':
            print('{"event":"playback_delivered","delivered_chars":7}', flush=True)
            marker = Path(os.environ['STOP_FIXTURE_PID'])
            pending = marker.with_suffix('.tmp')
            pending.write_text(json.dumps({'pid': os.getpid(), 'operation_id': operation['operation_id']}))
            pending.replace(marker)
            if os.environ['STOP_FIXTURE_MODE'] == 'voice':
                print('{"event":"control_stopped"}', flush=True)
            time.sleep(60)
        else:
            print('{"event":"result","result":{}}', flush=True)


async def service() -> None:
    from apps.audio.main import serve
    read_text = Path.read_text
    spawn = asyncio.create_subprocess_exec

    def model_manifest(path: Path, *args, **kwargs):
        if path == ROOT / 'config/models.json':
            return json.dumps({'models': [{
                'id': 'de_DE-thorsten-medium',
                'sha256': hashlib.sha256(b'fixture-model').hexdigest(),
                'config_sha256': hashlib.sha256(b'{}').hexdigest(),
            }]})
        return read_text(path, *args, **kwargs)

    async def external_worker(*args, **kwargs):
        return await spawn(sys.executable, __file__, '--worker', **kwargs)

    # Replace only OS/model boundaries. Keep the service, Output adapter,
    # cancellation, disconnect handling and both real pipe/socket protocols.
    with patch.object(Path, 'read_text', model_manifest), patch(
            'asyncio.create_subprocess_exec', side_effect=external_worker):
        await serve()


if __name__ == '__main__':
    if '--worker' in sys.argv:
        worker()
    else:
        asyncio.run(service())
