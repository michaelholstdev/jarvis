"""One bounded resident worker; cancellation destroys its model and PCM buffers."""
from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
import hashlib
from importlib import import_module
import json
import os
import signal
from pathlib import Path
import sys
import time
from typing import Any


safe_diagnostic = import_module(
    'apps.audio.audio_errors' if __package__ else 'audio_errors'
).safe_diagnostic


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
    code = safe_diagnostic(event.get('diagnostic'))
    print(json.dumps({'event': 'audio_diagnostic', 'code': code}), flush=True)


class Output:
    def __init__(self, config: dict[str, Any]) -> None:
        self.evidence = import_module('apps.audio.buffers' if __package__ else 'buffers').BufferEvidence()
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self.wake_ready = False
        self.busy = False
        self.idle = asyncio.Event()
        self.idle.set()
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
            try:
                ready = json.loads(line)
            except ValueError:
                ready = None
            if generation != self.generation or not isinstance(ready, dict) or ready.get('event') != 'ready':
                if isinstance(ready, dict):
                    report_diagnostic(ready)
                raise OutputError('output_runtime_unavailable')
            self.wake_ready = ready.get('wake_ready') is True
            if ready.get('wake_diagnostic'):
                report_diagnostic({'diagnostic': ready['wake_diagnostic']})
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

    async def stop(self, *, preserve_delivery_for: str | None = None) -> None:
        self.wake_ready = False
        stopped_generation = self.generation
        self.generation += 1
        process, self.process = self.process, None
        spawning = self.spawning
        # A disconnected play request precedes its cancel request. Keep only
        # that operation's content-free delivery count until cancel consumes it.
        # Privacy/default cleanup and later operations always erase the count.
        if self.completed is None or self.completed[0] != preserve_delivery_for:
            self.completed = None
        if spawning is not None:
            try:
                pending = await spawning
                await self.destroy(pending)
            except OSError:
                pass
        if process is not None:
            await self.destroy(process)
        self.evidence.terminated(stopped_generation)

    def run(self, operation: dict[str, Any], on_speech: Callable[[], None] | None = None, on_control: Callable[[], None] | None = None, *, on_delivery: Callable[[int], None] | None = None) -> Coroutine[Any, Any, dict[str, Any]]:
        # Capture admission before create_task can queue work behind a privacy barrier.
        return self._run(operation, self.generation, on_speech, on_control, on_delivery)

    async def _run(self, operation: dict[str, Any], generation: int, on_speech: Callable[[], None] | None, on_control: Callable[[], None] | None, on_delivery: Callable[[int], None] | None) -> dict[str, Any]:
        kind = operation['type']
        if kind in {'cancel', 'privacy'}:
            delivered = self.completed[1] if kind == 'cancel' and self.completed and self.completed[0] == operation.get('target_operation_id') else 0
            await self.stop()
            await self.idle.wait()
            print(json.dumps({'event': 'interruption', 'operation_id': operation['operation_id'],
                              'target_operation_id': operation.get('target_operation_id'),
                              'monotonic_ms': time.monotonic_ns() / 1e6}), flush=True)
            return {'completed': False, 'delivered_chars': delivered}
        if generation != self.generation:
            raise OutputError('unavailable')
        if self.busy:
            raise OutputError('busy')
        self.completed = None
        if kind == 'recognize' and self.config.get('audio', {}).get('mode') != 'voice':
            if 'text' not in operation:
                raise OutputError('invalid_message')
            return {'text': operation['text']}
        if kind == 'recognize' and 'text' in operation:
            raise OutputError('invalid_message')
        self.busy = True
        self.idle.clear()
        try:
            if self.process is None:
                await self.start()
            process = self.process
            assert process and process.stdin and process.stdout
            if kind in {'wake', 'recognize'}:
                self.evidence.begin(operation, generation)
            request = {**operation, 'diagnostic_generation': generation,
                       'diagnostic_sequence': self.evidence.sequence}
            process.stdin.write((json.dumps(request) + '\n').encode())
            await process.stdin.drain()
            timeout = (
                self.config['vad']['max_utterance_seconds'] +
                self.config['session']['recognition_completion_seconds']
                if kind == 'recognize' else self.config['recovery']['playback_timeout_ms'] / 1000
            )
            if kind == 'wake':
                timeout = 24 * 3600
            loop = asyncio.get_running_loop()
            deadline = loop.time() + timeout
            while True:
                remaining = max(0, deadline - loop.time())
                line = await asyncio.wait_for(process.stdout.readline(), remaining)
                if generation != self.generation:
                    # Drain killed-worker diagnostics so pipe backpressure cannot
                    # prevent process.wait() during a privacy barrier.
                    while await process.stdout.read(8192):
                        pass
                    return {'completed': False, 'delivered_chars': 0}
                if not line:
                    if self.process is process:
                        raise OutputError('unavailable')
                    # A concurrent stop already destroyed this worker.
                    return {'completed': False, 'delivered_chars': 0}
                event = json.loads(line)
                if event['event'] == 'buffer_occupancy':
                    self.evidence.accept(event, operation, generation)
                    continue
                if event['event'] == 'speech_started' and on_speech is not None:
                    if kind == 'wake':
                        deadline = loop.time() + self.config['vad']['max_utterance_seconds'] + self.config['session']['recognition_completion_seconds']
                    on_speech()
                    on_speech = None
                if event['event'] == 'playback_delivered' and kind == 'play':
                    delivered = event.get('delivered_chars')
                    previous = self.completed[1] if self.completed else 0
                    if type(delivered) is not int or not previous <= delivered <= len(operation.get('text', '').encode('utf-16-le')) // 2:
                        raise OutputError('unavailable')
                    self.completed = (operation['operation_id'], delivered)
                    if on_delivery is not None:
                        on_delivery(delivered)
                if event['event'] == 'control_stopped' and kind == 'play' and on_control is not None:
                    on_control()
                    on_control = None
                if event['event'] == 'result':
                    result = dict(event['result'])
                    if kind == 'play' and result.get('completed'):
                        self.completed = (operation['operation_id'], result['delivered_chars'])
                    return result
                if event['event'] == 'error':
                    report_diagnostic(event)
                    raise OutputError('unavailable')
                print(json.dumps({'event': event['event'], 'operation_id': operation['operation_id'],
                                  **({'monotonic_ms': event['monotonic_ms']} if 'monotonic_ms' in event else {}),
                                  **({'elapsed_ms': event['elapsed_ms']} if 'elapsed_ms' in event else {}),
                                  **({'delivered_chars': event['delivered_chars']} if event['event'] == 'playback_delivered' else {})}), flush=True)
        except (OSError, ValueError, asyncio.TimeoutError, OutputError):
            if generation == self.generation:
                await self.stop()
            raise OutputError('unavailable') from None
        finally:
            self.busy = False
            self.idle.set()
