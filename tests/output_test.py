"""Public output-adapter cancellation checks at the OS process boundary."""
import asyncio
import unittest
from unittest.mock import patch

from apps.audio.main import parse_message
from apps.audio.output import Output, OutputError


class OutputCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def test_privacy_waits_for_inflight_spawn_and_destroys_its_worker(self) -> None:
        output = Output({'tts': {'model_path': '/nonexistent/voice.onnx'}})
        entered = asyncio.Event()
        release = asyncio.Event()
        spawn = asyncio.create_subprocess_exec

        async def delayed_spawn(*args, **kwargs):
            entered.set()
            await release.wait()
            return await spawn(*args, **kwargs)

        with patch('asyncio.create_subprocess_exec', side_effect=delayed_spawn):
            start = asyncio.create_task(output.run({'type': 'acknowledge', 'operation_id': 'old'}))
            await entered.wait()
            stop = asyncio.create_task(output.run({'type': 'privacy', 'operation_id': 'privacy'}))
            await asyncio.sleep(0)
            try:
                self.assertFalse(stop.done(), 'privacy cannot acknowledge before the pending spawn is cleaned up')
            finally:
                release.set()
                await asyncio.gather(start, stop, return_exceptions=True)
                await output.stop()
            self.assertIsNone(output.process)

    async def test_cleanup_invalidates_work_queued_before_the_barrier(self) -> None:
        for control in ('privacy', 'cancel', 'stop'):
            with self.subTest(control=control):
                output = Output({'tts': {'model_path': '/nonexistent/voice.onnx'}})
                with patch('asyncio.create_subprocess_exec', wraps=asyncio.create_subprocess_exec) as spawn:
                    queued = asyncio.create_task(output.run({'type': 'acknowledge', 'operation_id': 'old'}))
                    if control == 'stop':
                        await output.stop()
                    else:
                        await output.run({'type': control, 'operation_id': 'barrier'})
                    try:
                        with self.assertRaisesRegex(OutputError, '^unavailable$'):
                            await queued
                        spawn.assert_not_called()
                        self.assertEqual(await output.run({'type': 'recognize', 'operation_id': 'fresh', 'text': 'fixture'}), {'text': 'fixture'})
                    finally:
                        await output.stop()


class OutputProtocolTest(unittest.IsolatedAsyncioTestCase):
    async def test_missing_recognition_text_returns_allowlisted_error(self) -> None:
        message = parse_message(b'{"version":1,"type":"audio-operation","operation":{"type":"recognize","operation_id":"recognize"}}')
        with self.assertRaisesRegex(OutputError, '^invalid_message$'):
            await Output({}).run(message['operation'])


class VoiceRecognitionTest(unittest.IsolatedAsyncioTestCase):
    async def test_voice_recognition_uses_worker_final_transcript(self) -> None:
        import sys
        config = {'audio': {'mode': 'voice'}, 'recovery': {'playback_timeout_ms': 1000}}
        output = Output(config)
        spawn = asyncio.create_subprocess_exec
        # Substitute the external audio/model process, keeping the real pipe boundary.
        worker = ('import sys,json; json.loads(sys.stdin.readline()); '
                  'print(\'{"event":"ready"}\',flush=True); '
                  'op=json.loads(sys.stdin.readline()); '
                  'print(json.dumps({"event":"result","result":{"text":"Wie spät ist es?"}}),flush=True)')

        async def fixture_process(*args, **kwargs):
            return await spawn(sys.executable, '-c', worker, **kwargs)

        with patch('asyncio.create_subprocess_exec', side_effect=fixture_process):
            try:
                result = await output.run({'type': 'recognize', 'operation_id': 'mic'})
                self.assertEqual(result, {'text': 'Wie spät ist es?'})
            finally:
                await output.stop()
