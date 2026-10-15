"""Public output-adapter cancellation checks at the OS process boundary."""
import asyncio
import unittest
from unittest.mock import patch

from apps.audio.output import Output


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
