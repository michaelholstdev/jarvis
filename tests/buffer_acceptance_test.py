"""Finite acceptance CLI/report seam with real production audio sockets."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


class BufferAcceptanceTest(unittest.TestCase):
    def run_bounds(self, output, *args, **env):
        return subprocess.run([sys.executable, '-m', 'benchmarks.stability.bounds',
                               '--output', str(output), '--occupancy-only', *args],
                              env={**os.environ, **env}, capture_output=True, timeout=40)

    def test_fixture_report_observes_production_buffers_and_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bounds.json'
            result = self.run_bounds(output)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            report = json.loads(output.read_text())
            self.assertTrue(report['run_completed'])
            occupancy = report['occupancy']
            self.assertEqual(occupancy['verdict'], 'passed')
            self.assertEqual(len(occupancy['coverage']), 8)
            self.assertEqual(occupancy['buffers']['pre_roll']['high_water_bytes'], 47104)
            self.assertGreater(occupancy['operations'][0]['overwritten_frames'], 100)
            self.assertEqual(report['checks']['native_audio_buffer_occupancy'], 'unvalidated')
            lock = next(run for run in occupancy['operations'] if run['operation_id'] == 'lock')
            self.assertEqual(lock['buffer_verdicts']['raw_pcm'], 'unvalidated')
            self.assertNotIn('Wie spät', output.read_text())

    def test_missing_observations_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bounds.json'
            output.write_text('{"run_completed":true,"checks":{"execution":"passed"}}')
            result = self.run_bounds(output, WAKE_FIXTURE_EVIDENCE_FAULT='missing')
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(output.read_text())
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['occupancy']['buffers']['handoff']['verdict'], 'unvalidated')

    def test_stale_operation_and_generation_observations_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bounds.json'
            result = self.run_bounds(output, WAKE_FIXTURE_EVIDENCE_FAULT='stale')
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            report = json.loads(output.read_text())
            self.assertGreater(report['occupancy']['rejected_observations'], 0)
            self.assertEqual(report['occupancy']['buffers']['pre_roll']['high_water_bytes'], 47104)

    def test_bound_violation_is_recorded_without_increasing_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bounds.json'
            result = self.run_bounds(output, WAKE_FIXTURE_RESAMPLE_MULTIPLIER='8')
            self.assertNotEqual(result.returncode, 0)
            report = json.loads(output.read_text())
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['occupancy']['buffers']['resampled_pending']['verdict'], 'failed')

    def test_observed_cancellation_overflow_remains_failed_with_incomplete_evidence(self):
        for fault in ('cancel_sample_overflow', 'cancel_byte_overflow', 'cancel_overflow_missing'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'bounds.json'
                result = self.run_bounds(output, WAKE_FIXTURE_EVIDENCE_FAULT=fault)
                self.assertNotEqual(result.returncode, 0)
                report = json.loads(output.read_text())
                self.assertFalse(report['run_completed'])
                occupancy = report['occupancy']
                lock = next(run for run in occupancy['operations'] if run['operation_id'] == 'lock')
                self.assertEqual(lock['outcome'], 'worker_terminated')
                self.assertEqual(lock['buffer_verdicts']['raw_pcm'], 'failed')
                self.assertEqual(occupancy['buffers']['raw_pcm']['verdict'], 'failed')
                if fault == 'cancel_overflow_missing':
                    recovery = next(run for run in occupancy['operations'] if run['operation_id'] == 'recovery')
                    self.assertEqual(recovery['buffer_verdicts']['raw_pcm'], 'unvalidated')

    def test_invalid_and_failed_reruns_invalidate_previous_passing_report(self):
        for arguments in (('--unknown',), ('--fixture-service', '/missing/fixture.py'), ('--output',)):
            with self.subTest(arguments=arguments), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'bounds.json'
                output.write_text('{"run_completed":true,"checks":{"execution":"passed"}}')
                result = self.run_bounds(output, *arguments)
                self.assertNotEqual(result.returncode, 0)
                report = json.loads(output.read_text())
                self.assertFalse(report['run_completed'])
                self.assertNotIn('passed', report['checks'].values())

    def test_interrupted_run_cannot_leave_previous_passing_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bounds.json'
            output.write_text('{"run_completed":true}')
            process = subprocess.Popen([sys.executable, '-m', 'benchmarks.stability.bounds',
                                        '--output', str(output), '--occupancy-only'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(300):
                    if not json.loads(output.read_text()).get('run_completed'):
                        break
                    time.sleep(.01)
                else:
                    self.fail('run did not invalidate report')
                process.terminate()
                process.wait(timeout=10)
                self.assertNotEqual(process.returncode, 0)
                self.assertFalse(json.loads(output.read_text())['run_completed'])
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
