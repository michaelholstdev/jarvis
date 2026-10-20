"""Wake input and lifecycle through the real audio socket; no physical capture."""
import asyncio
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest


class WakeSocketTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        try:
            __import__('numpy')
        except ImportError:
            self.skipTest('install voice extras for PCM socket fixtures')
        self.temp = tempfile.TemporaryDirectory(prefix='jv-wake-')
        self.root = Path(self.temp.name)
        for name in ('voice.onnx', 'tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx',
                     'tiny-tokens.txt', 'silero_vad.onnx', 'hey_jarvis_v0.1.onnx',
                     'melspectrogram.onnx', 'embedding_model.onnx'):
            (self.root / name).write_bytes(b'fixture-model')
        (self.root / 'voice.onnx.json').write_text('{}')
        self.config = {'audio': {'mode': 'voice', 'input_device': 'fixture', 'output_device': 'fixture'},
                       'stt': {'model_dir': str(self.root)},
                       'tts': {'model_path': str(self.root / 'voice.onnx')},
                       'wake_word': {'model_path': str(self.root / 'hey_jarvis_v0.1.onnx')}}
        self.process = None
        self.writers = []

    async def start(self, enabled=True):
        self.config['wake_word']['enabled'] = enabled
        path = self.root / 'config.json'
        path.write_text(json.dumps(self.config))
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, 'tests/fixtures/wake/audio_service.py',
            env={**os.environ, 'JARVIS_CONFIG': str(path), 'XDG_RUNTIME_DIR': str(self.root),
                 'WAKE_FIXTURE_PID': str(self.root / 'capture.pid'),
                 'WAKE_FIXTURE_TRIGGER': str(self.root / 'trigger')},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        while True:
            line = await asyncio.wait_for(self.process.stdout.readline(), 10)
            if not line:
                self.fail((await self.process.stderr.read()).decode())
            if b'service_started' in line:
                break

    async def exchange(self, message):
        reader, writer = await asyncio.open_unix_connection(str(self.root / 'jarvis/audio.sock'))
        self.writers.append(writer)
        writer.write((json.dumps(message) + '\n').encode())
        await writer.drain()
        return reader, writer

    async def operation(self, kind, **values):
        return await self.exchange({'version': 1, 'type': 'audio-operation',
                                    'operation': {'type': kind, 'operation_id': kind, **values}})

    async def until(self, predicate):
        for _ in range(200):
            if predicate():
                return
            await asyncio.sleep(.01)
        self.fail('fixture process boundary timed out')

    async def test_continuous_question_and_bounded_overwritten_preroll(self):
        await self.start()
        reader, _ = await self.operation('wake')
        await self.until(lambda: (self.root / 'capture.pid').exists())
        # The wake operation remains idle while old PCM is overwritten.
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(reader.readline(), .2)
        (self.root / 'trigger').touch()
        started = json.loads(await asyncio.wait_for(reader.readline(), 5))
        self.assertEqual(started['type'], 'speech-started')
        final = json.loads(await asyncio.wait_for(reader.readline(), 5))
        self.assertEqual(final['text'], 'Wie spät ist es?')
        self.assertEqual(final['operation_id'], 'wake')

    async def test_disconnect_and_privacy_destroy_capture_and_recovery_does_not_replay(self):
        await self.start()
        for inhibition in (None, {'locked': True, 'muted': False, 'hardware_muted': False}):
            reader, writer = await self.operation('wake')
            await self.until(lambda: (self.root / 'capture.pid').exists())
            pid = int((self.root / 'capture.pid').read_text())
            if inhibition is None:
                writer.close()
                await writer.wait_closed()
            else:
                privacy, _ = await self.operation('privacy', inhibitions=inhibition)
                self.assertEqual(json.loads(await asyncio.wait_for(privacy.readline(), 3))['type'], 'audio-result')
            def stopped():
                # Linux can retain a killed child as a zombie until its parent reaps it.
                path = Path(f'/proc/{pid}/stat')
                return not path.exists() or path.read_text().split()[2] == 'Z'
            await self.until(stopped)
            (self.root / 'capture.pid').unlink()
            await asyncio.sleep(.1)
            self.assertFalse((self.root / 'capture.pid').exists(), 'recovery alone cannot replay capture')
            barrier, _ = await self.operation('privacy', inhibitions={'locked': False, 'muted': False, 'hardware_muted': False})
            await asyncio.wait_for(barrier.readline(), 3)

    async def test_missing_model_keeps_manual_fallback_without_idle_capture(self):
        (self.root / 'hey_jarvis_v0.1.onnx').unlink()
        await self.start()
        health, _ = await self.exchange({'version': 1, 'type': 'hello', 'role': 'core'})
        self.assertEqual(json.loads(await health.readline())['capabilities']['wake'], 'unavailable')
        self.assertFalse((self.root / 'capture.pid').exists())

    async def test_explicit_disable_keeps_manual_only_idle(self):
        await self.start(enabled=False)
        health, _ = await self.exchange({'version': 1, 'type': 'hello', 'role': 'core'})
        result = json.loads(await health.readline())
        self.assertEqual(result['capabilities']['wake'], 'unavailable')
        self.assertEqual(result['capabilities']['stt'], 'ready')
        await asyncio.sleep(.1)
        self.assertFalse((self.root / 'capture.pid').exists())

    async def asyncTearDown(self):
        for writer in self.writers:
            writer.close()
            await writer.wait_closed()
        if self.process and self.process.returncode is None:
            self.process.send_signal(signal.SIGTERM)
            await asyncio.wait_for(self.process.wait(), 5)
        self.temp.cleanup()
