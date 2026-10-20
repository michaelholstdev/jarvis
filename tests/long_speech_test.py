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
                    config['llm']['max_context_tokens'] = 512
                    small_sentence = 'Ein Computer verarbeitet Daten. '
                    result = await output.run({'type': 'synthesize', 'operation_id': 'small-budget', 'text': small_sentence * 16})
                    self.assertEqual(result['text'], small_sentence * 12 + notice)
                    self.assertLessEqual(len(result['text'].encode('utf-8')), 512)
                    await output.stop()
                    config['llm']['max_context_tokens'] = 8192
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

    async def test_failure_indication_speaks_once_or_falls_back_without_reply_delivery(self):
        try:
            __import__('numpy')
        except ImportError:
            self.skipTest('install --extra output for waveform checks')
        spawn = asyncio.create_subprocess_exec
        for broken in ('0', '1'):
            async def fixture_process(*args, **kwargs):
                return await spawn(sys.executable, 'tests/fixtures/long-speech/worker.py',
                                   env={**os.environ, 'JARVIS_TEST_FAILURE_SYNTHESIS': broken}, **kwargs)
            config = load_config()
            config['audio'].update(mode='piper', output_device='fixture')
            with tempfile.TemporaryDirectory() as directory:
                config['tts']['model_path'] = str(Path(directory) / 'voice.onnx')
                Path(config['tts']['model_path'] + '.json').write_text('{}')
                output = Output(config)
                events = []
                with patch('asyncio.create_subprocess_exec', side_effect=fixture_process), patch('builtins.print', side_effect=lambda line, **_: events.append(json.loads(line))):
                    try:
                        report = await output.run({'type': 'indicate-failure', 'operation_id': 'failure'})
                        self.assertEqual(report, {'completed': True, 'delivered_chars': 0})
                        kinds = [event['event'] for event in events]
                        self.assertEqual(kinds.count('failure_indication_spoken'), int(broken == '0'))
                        self.assertEqual(kinds.count('failure_indication_fallback'), int(broken == '1'))
                        self.assertEqual(kinds.count('playback_completed'), 1)
                        self.assertNotIn('playback_delivered', kinds)
                        self.assertNotIn('SECRET_SYNTHESIS_ERROR', json.dumps(events))
                    finally:
                        await output.stop()
