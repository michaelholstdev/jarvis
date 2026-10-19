"""Bounded long speech through Output.run and the real worker pipe protocol."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from apps.audio.main import load_config
from apps.audio.output import Output


class LongSpeechTest(unittest.IsolatedAsyncioTestCase):
    async def test_long_answer_plays_a_bounded_prefix_and_full_text_notice(self):
        try:
            __import__('numpy')
        except ImportError:
            self.skipTest('install --extra output for waveform checks')
        sentence = 'Ein Computer verarbeitet Daten und führt Programme aus. '
        notice = 'Die Antwort ist zu lang zum Vorlesen. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.'
        spawn = asyncio.create_subprocess_exec
        block = False

        async def fixture_process(*args, **kwargs):
            return await spawn(sys.executable, 'tests/fixtures/long-speech/worker.py',
                               env={**os.environ, 'JARVIS_TEST_BLOCK_PLAYBACK': str(int(block))}, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            config = load_config()
            config['audio'].update(mode='piper', output_device='fixture')
            config['tts']['model_path'] = str(Path(directory) / 'voice.onnx')
            Path(config['tts']['model_path'] + '.json').write_text(json.dumps({}))
            output = Output(config)
            with patch('asyncio.create_subprocess_exec', side_effect=fixture_process):
                try:
                    for text, expected, units in (
                        (sentence * 20, sentence * 15 + notice, 945),
                        (sentence * 60, sentence * 15 + notice, 945),
                        ('LANGER_SATZ ohne Satzende', notice, 105),
                        (sentence * 2, sentence * 2, 112),
                        ('😀. 😀. ', '😀. 😀. ', 8),
                    ):
                        with self.subTest(text=text[:20]):
                            result = await output.run({'type': 'synthesize', 'operation_id': 'synth', 'text': text})
                            self.assertEqual(result.get('text', text), expected)
                            delivered = []
                            report = await output.run({'type': 'play', 'operation_id': 'play', 'text': expected}, on_delivery=delivered.append)
                            self.assertEqual(report, {'completed': True, 'delivered_chars': units})
                            self.assertEqual(delivered[-1], units)
                            await output.stop()
                    block = True
                    result = await output.run({'type': 'synthesize', 'operation_id': 'synth', 'text': sentence * 20})
                    delivered_first = asyncio.Event()
                    playback = asyncio.create_task(output.run(
                        {'type': 'play', 'operation_id': 'cancel-play', 'text': result['text']},
                        on_delivery=lambda _: delivered_first.set(),
                    ))
                    await asyncio.wait_for(delivered_first.wait(), 3)
                    report = await output.run({'type': 'cancel', 'operation_id': 'cancel', 'target_operation_id': 'cancel-play'})
                    self.assertEqual(report, {'completed': False, 'delivered_chars': 56})
                    await playback
                    self.assertEqual(await output.run({'type': 'privacy', 'operation_id': 'privacy'}),
                                     {'completed': False, 'delivered_chars': 0})
                finally:
                    await output.stop()
