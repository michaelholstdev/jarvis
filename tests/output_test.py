"""Public output-adapter cancellation checks at the OS process boundary."""
import asyncio
import unittest
from unittest.mock import patch

from apps.audio.main import load_config, parse_message
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
        config = load_config()
        config['audio']['mode'] = 'voice'
        config['recovery']['playback_timeout_ms'] = 1000
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


    async def test_microphone_recognition_outlasts_a_short_playback_watchdog(self) -> None:
        import sys
        config = load_config()
        config['audio']['mode'] = 'voice'
        config['recovery']['playback_timeout_ms'] = 1000
        output = Output(config)
        spawn = asyncio.create_subprocess_exec
        worker = ('import sys,json,time; json.loads(sys.stdin.readline()); '
                  'print(\'{"event":"ready"}\',flush=True); '
                  'json.loads(sys.stdin.readline()); time.sleep(1.2); '
                  'print(\'{"event":"result","result":{"text":"Eine Testfrage"}}\',flush=True)')

        async def fixture_process(*args, **kwargs):
            return await spawn(sys.executable, '-c', worker, **kwargs)

        with patch('asyncio.create_subprocess_exec', side_effect=fixture_process):
            try:
                result = await output.run({'type': 'recognize', 'operation_id': 'mic'})
                self.assertEqual(result, {'text': 'Eine Testfrage'})
            finally:
                await output.stop()

    async def test_worker_events_cannot_renew_the_recognition_deadline(self) -> None:
        import sys
        config = load_config()
        config['audio']['mode'] = 'voice'
        config['vad']['max_utterance_seconds'] = 1
        config['session']['recognition_completion_seconds'] = 1
        config['recovery']['playback_timeout_ms'] = 10000
        output = Output(config)
        spawn = asyncio.create_subprocess_exec
        worker = ('import sys,json,time; json.loads(sys.stdin.readline()); '
                  'print(\'{"event":"ready"}\',flush=True); '
                  'json.loads(sys.stdin.readline()); '
                  'time.sleep(.75); print(\'{"event":"speech_started"}\',flush=True); '
                  'time.sleep(.75); print(\'{"event":"endpoint"}\',flush=True); '
                  'time.sleep(.75); print(\'{"event":"result","result":{"text":"late"}}\',flush=True)')

        async def fixture_process(*args, **kwargs):
            return await spawn(sys.executable, '-c', worker, **kwargs)

        with patch('asyncio.create_subprocess_exec', side_effect=fixture_process):
            try:
                with self.assertRaisesRegex(OutputError, '^unavailable$'):
                    await output.run({'type': 'recognize', 'operation_id': 'mic'})
                self.assertIsNone(output.process, 'timed-out capture must be destroyed')
            finally:
                await output.stop()
