"""Acceptance command seam, using isolated real core/Python sockets."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class IdleAcceptanceTest(unittest.TestCase):
    def test_short_run_cannot_claim_two_hour_or_real_device_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'idle.json'
            result = subprocess.run([sys.executable, '-m', 'benchmarks.stability.idle',
                                     '--seconds', '0.2', '--interval', '0.1',
                                     '--output', str(output)], capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            report = json.loads(output.read_text())
            self.assertEqual(report['checks']['two_hour_duration'], 'unvalidated')
            self.assertEqual(report['checks']['idle_operations'], 'passed')
            self.assertEqual(report['checks']['idle_state_and_text_cleared'], 'passed')
            self.assertEqual(report['checks']['queues_and_audio_buffers'], 'unvalidated')
            self.assertEqual(report['mode'], 'mock')
            self.assertGreaterEqual(len(report['samples']), 2)
            self.assertGreaterEqual(report['elapsed_seconds'], .2)
            self.assertNotIn('stability privacy sentinel', json.dumps(report))

    def test_failed_rerun_replaces_prior_passing_idle_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'idle.json'
            output.write_text('{"run_completed":true,"checks":{"resource_screen":"passed"}}')
            result = subprocess.run([sys.executable, '-m', 'benchmarks.stability.idle',
                                     '--config', str(Path(directory) / 'missing.json'),
                                     '--output', str(output)], capture_output=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(output.read_text())
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['checks']['execution'], 'failed')

    def test_failed_offline_rerun_cannot_reuse_a_prior_voice_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for name in ('offline.json', 'voice.json'):
                (output / name).write_text('{"run_completed":true}')
            result = subprocess.run([sys.executable, '-m', 'benchmarks.stability.offline',
                                     '--model-store', str(output / 'missing'),
                                     '--output', str(output)], capture_output=True, timeout=30)
            self.assertNotEqual(result.returncode, 0)
            report = json.loads((output / 'offline.json').read_text())
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['checks']['execution'], 'failed')
            self.assertFalse(json.loads((output / 'voice.json').read_text())['run_completed'])
