"""One bounded resident worker; cancellation destroys its model and PCM buffers."""
from __future__ import annotations

import asyncio
from collections.abc import Coroutine
import hashlib
import json
import os
import signal
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
            hasher = hashlib.sha256()
            while block := source.read(1024 * 1024):
                hasher.update(block)
            digest = hasher.hexdigest()
        if digest != checksum:
            raise OutputError('voice_checksum_mismatch')


def report_diagnostic(event: dict[str, Any]) -> None:
    known = {
        'missing_input_model', 'input_checksum_mismatch', 'unsupported_input_runtime',
        'input_device_missing', 'input_device_muted', 'input_format_unsupported',
        'input_disconnected', 'output_device_missing', 'output_device_muted',
    }
    code = event.get('diagnostic')
    print(json.dumps({'event': 'audio_diagnostic',
                      'code': code if code in known else 'audio_runtime_failed'}), flush=True)


class Output:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self.busy = False
        self.generation = 0
        self.spawning: asyncio.Task[asyncio.subprocess.Process] | None = None
        self.completed: tuple[str, int] | None = None

    async def start(self) -> None:
        generation = self.generation
        spawning = asyncio.create_task(asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name('output_worker.py')),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=8192, start_new_session=True,
        ))
        self.spawning = spawning
        process: asyncio.subprocess.Process | None = None
        try:
            process = await spawning
            if generation != self.generation:
                raise OutputError('unavailable')
            self.process = process
            assert process.stdin and process.stdout
            process.stdin.write((json.dumps(self.config) + '\n').encode())
            await process.stdin.drain()
            line = await asyncio.wait_for(process.stdout.readline(), 30)
            if generation != self.generation or line != b'{"event":"ready"}\n':
                try:
                    report_diagnostic(json.loads(line))
                except (ValueError, TypeError):
                    pass
                raise OutputError('output_runtime_unavailable')
        except (OSError, asyncio.TimeoutError, OutputError):
            if process is not None:
                await self.destroy(process)
            if self.process is process:
                self.process = None
            raise OutputError('output_runtime_unavailable') from None
        finally:
            if self.spawning is spawning:
                self.spawning = None

    @staticmethod
    async def destroy(process: asyncio.subprocess.Process) -> None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()

    async def stop(self) -> None:
        self.generation += 1
        process, self.process = self.process, None
        spawning = self.spawning
        self.completed = None
        if spawning is not None:
            try:
                pending = await spawning
                await self.destroy(pending)
            except OSError:
                pass
        if process is not None:
            await self.destroy(process)

    def run(self, operation: dict[str, Any]) -> Coroutine[Any, Any, dict[str, Any]]:
        # Capture admission before create_task can queue work behind a privacy barrier.
        return self._run(operation, self.generation)

    async def _run(self, operation: dict[str, Any], generation: int) -> dict[str, Any]:
        kind = operation['type']
        if kind in {'cancel', 'privacy'}:
            delivered = self.completed[1] if self.completed and self.completed[0] == operation.get('target_operation_id') else 0
            await self.stop()
            print(json.dumps({'event': 'playback_cancelled', 'operation_id': operation['operation_id']}), flush=True)
            return {'completed': False, 'delivered_chars': delivered}
        if generation != self.generation:
            raise OutputError('unavailable')
        if kind == 'recognize' and self.config.get('audio', {}).get('mode') != 'voice':
            if 'text' not in operation:
                raise OutputError('invalid_message')
            return {'text': operation['text']}
        if kind == 'recognize' and 'text' in operation:
            raise OutputError('invalid_message')
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
                    report_diagnostic(event)
                    raise OutputError('unavailable')
                print(json.dumps({'event': event['event'], 'operation_id': operation['operation_id'],
                                  **({'elapsed_ms': event['elapsed_ms']} if 'elapsed_ms' in event else {})}), flush=True)
        except (OSError, ValueError, asyncio.TimeoutError, OutputError):
            if generation == self.generation:
                await self.stop()
            raise OutputError('unavailable') from None
        finally:
            self.busy = False
