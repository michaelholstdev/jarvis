"""Agreed seam: recording-based wake evaluation CLI and its JSON report."""
import json
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave


class WakeEvaluationTest(unittest.TestCase):
    def test_muted_headset_refuses_recording_without_creating_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {'name': 'test-headset', 'mute': True, 'index': 1,
                      'properties': {'node.name': 'test-headset'}}
            pactl = root / 'pactl'
            pactl.write_text('#!/bin/sh\nprintf \'%s\\n\' \'' + json.dumps([source]) + "'\n")
            pactl.chmod(0o700)
            recordings = root / 'recordings'
            result = subprocess.run([
                sys.executable, '-m', 'benchmarks.wake.record', '--source', 'test-headset',
                '--directory', str(recordings),
            ], env={**os.environ, 'PATH': str(root)}, input='', capture_output=True,
                text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('recording_failed_or_privacy_inhibited', result.stderr)
            self.assertFalse(recordings.exists())

    def test_interrupted_recording_session_is_rejected_before_loading_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corpus = root / 'corpus.json'
            corpus.write_text(json.dumps({'run_completed': False, 'trials': [{
                'id': 'negative-01', 'condition': 'quiet', 'intended_wake': False,
                'path': 'partial.wav', 'sha256': '0' * 64,
            }]}))
            output = root / 'result.json'
            result = subprocess.run([
                sys.executable, '-m', 'benchmarks.wake.evaluate', '--corpus', str(corpus),
                '--models', str(root), '--output', str(output), '--threshold', '.5',
            ], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(output.read_text())['error'], 'invalid_corpus')

    def test_empty_corpus_replaces_stale_success_with_failed_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corpus = root / 'corpus.json'
            corpus.write_text(json.dumps({'trials': []}))
            output = root / 'result.json'
            output.write_text(json.dumps({'run_completed': True, 'screen_passed': True}))
            result = subprocess.run([
                sys.executable, '-m', 'benchmarks.wake.evaluate', '--corpus', str(corpus),
                '--models', str(root), '--output', str(output), '--threshold', '0.5',
            ], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(output.read_text())
            self.assertFalse(report['run_completed'])
            self.assertFalse(report['screen_passed'])
            self.assertEqual(report['error'], 'invalid_corpus')

    def test_invalid_threshold_cannot_leave_success_or_expose_audio_paths(self):
        for threshold in ('nan', 'inf', '0', '1', '-1', 'invalid'):
            with self.subTest(threshold=threshold), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                corpus = root / 'corpus.json'
                corpus.write_text(json.dumps({'trials': [{
                    'id': 'negative-01', 'condition': 'quiet', 'intended_wake': False,
                    'path': 'private-audio.wav', 'sha256': '0' * 64,
                }]}))
                output = root / 'result.json'
                output.write_text('{"run_completed": true}')
                result = subprocess.run([
                    sys.executable, '-m', 'benchmarks.wake.evaluate', '--corpus', str(corpus),
                    '--models', str(root), '--output', str(output), '--threshold', threshold,
                ], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                report = json.loads(output.read_text())
                self.assertFalse(report['run_completed'])
                self.assertEqual(report['error'], 'invalid_threshold')
                self.assertNotIn('private-audio', output.read_text() + result.stderr)

    @unittest.skipUnless(
        importlib.util.find_spec('openwakeword')
        and Path('models/wake/hey_jarvis_v0.1.onnx').is_file(),
        'opt-in real candidate models/runtime are not installed',
    )
    def test_truncated_recording_cannot_complete_a_real_detector_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / 'negative.wav'
            with wave.open(str(audio), 'wb') as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(16000)
                target.writeframes(b'\x00' * 32000)
            # Retain the one-second WAV header but remove half its PCM payload.
            audio.write_bytes(audio.read_bytes()[:16044])
            corpus = root / 'corpus.json'
            corpus.write_text(json.dumps({'trials': [{
                'id': 'negative-01', 'condition': 'quiet', 'intended_wake': False,
                'path': audio.name, 'sha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
            }]}))
            output = root / 'result.json'
            result = subprocess.run([
                sys.executable, '-m', 'benchmarks.wake.evaluate', '--corpus', str(corpus),
                '--models', 'models/wake', '--output', str(output), '--threshold', '.5',
            ], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 2)
            report = json.loads(output.read_text())
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['error'], 'truncated_audio')
