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
