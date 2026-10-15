"""One bounded resident worker; cancellation destroys its model and PCM buffers."""
from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
import sys
from typing import Any


class OutputError(Exception):
    """Content-free audio diagnostic."""


def verify_voice(config: dict[str, Any]) -> None:
    path = Path(config['tts']['model_path'])
    manifest = json.loads((Path(__file__).resolve().parents[2] / 'config/models.json').read_text())
    voice = next((item for item in manifest['models'] if item['id'] == config['tts']['voice']), None)
    if voice is None:
        raise OutputError('unsupported_voice')
    for file, checksum in ((path, voice['sha256']), (Path(str(path) + '.json'), voice['config_sha256'])):
        if not file.is_file():
            raise OutputError('missing_voice')
        with file.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest() if sys.version_info >= (3, 11) else hashlib.sha256(source.read()).hexdigest()
        if digest != checksum:
            raise OutputError('voice_checksum_mismatch')


class Output:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self.busy = False
        self.completed: tuple[str, int] | None = None

    async def start(self) -> None:
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name('output_worker.py')),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=8192,
        )
        assert self.process.stdin and self.process.stdout
        self.process.stdin.write((json.dumps(self.config) + '\n').encode())
        await self.process.stdin.drain()
        try:
            line = await asyncio.wait_for(self.process.stdout.readline(), 30)
            if line != b'{"event":"ready"}\n':
                raise OutputError('output_runtime_unavailable')
        except (OSError, asyncio.TimeoutError, OutputError):
            await self.stop()
            raise OutputError('output_runtime_unavailable') from None

    async def stop(self) -> None:
        process, self.process = self.process, None
        self.completed = None
        if process is not None:
            if process.returncode is None:
                process.kill()
            await process.wait()

    async def run(self, operation: dict[str, Any]) -> dict[str, Any]:
        kind = operation['type']
        if kind in {'cancel', 'privacy'}:
            delivered = self.completed[1] if self.completed and self.completed[0] == operation.get('target_operation_id') else 0
            await self.stop()
            print(json.dumps({'event': 'playback_cancelled', 'operation_id': operation['operation_id']}), flush=True)
            return {'completed': False, 'delivered_chars': delivered}
        if kind == 'recognize':
            return {'text': operation['text']}
        if self.busy:
            raise OutputError('busy')
        self.busy = True
        try:
            if self.process is None:
                await self.start()
            process = self.process
            assert process and process.stdin and process.stdout
            process.stdin.write((json.dumps(operation) + '\n').encode())
            await process.stdin.drain()
            while True:
                line = await asyncio.wait_for(process.stdout.readline(), self.config['recovery']['playback_timeout_ms'] / 1000)
                if not line:
                    if self.process is process:
                        raise OutputError('unavailable')
                    # A concurrent stop already destroyed this worker.
                    return {'completed': False, 'delivered_chars': 0}
                event = json.loads(line)
                if event['event'] == 'result':
                    result = dict(event['result'])
                    if kind == 'play' and result.get('completed'):
                        self.completed = (operation['operation_id'], result['delivered_chars'])
                    return result
                if event['event'] == 'error':
                    raise OutputError('unavailable')
                print(json.dumps({'event': event['event'], 'operation_id': operation['operation_id']}), flush=True)
        except (OSError, ValueError, asyncio.TimeoutError, OutputError):
            await self.stop()
            raise OutputError('unavailable') from None
        finally:
            self.busy = False
