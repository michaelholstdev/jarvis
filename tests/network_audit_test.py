"""Network acceptance CLI with an external tracer fixture."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class NetworkAuditTest(unittest.TestCase):
    def run_audit(self, root, trace, *options):
        tracer = root / 'strace'
        script = "cat >&2 <<'TRACE'\n" + trace + 'TRACE\n' if trace is not None else 'exec /bin/sleep 60\n'
        tracer.write_text('#!/bin/sh\n' + script)
        tracer.chmod(0o755)
        output = root / 'report.json'
        output.write_text('{"run_completed":true,"checks":{"external_connection_attempts":"passed"}}')
        result = subprocess.run(
            [sys.executable, '-m', 'benchmarks.stability.network',
             '--output', str(output), *options, '--', 'private sentinel'],
            env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH']},
            capture_output=True, timeout=10)
        return result, json.loads(output.read_text())

    def test_failed_external_connection_is_an_attempt_and_content_is_not_saved(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = ('connect(3, {sa_family=AF_INET, sin_port=htons(443), '
                     'sin_addr=inet_addr("203.0.113.1")}, 16) = -1 ENETUNREACH\n'
                     '+++ exited with 0 +++\n')
            result, report = self.run_audit(Path(directory), trace)
            self.assertEqual(result.returncode, 1, result.stderr.decode())
            self.assertEqual(report['external_connections'], 1)
            self.assertEqual(report['checks']['external_connection_attempts'], 'failed')
            self.assertNotIn('203.0.113.1', json.dumps(report))
            self.assertNotIn('inet_addr', json.dumps(report))

    def test_loopback_connections_pass_only_the_connection_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = ('[pid 12] connect(3, {sa_family=AF_INET, '
                     'sin_addr=inet_addr("127.0.0.1")}, 16) = -1 EINPROGRESS\n'
                     '[pid 12] connect(4, {sa_family=AF_INET6, '
                     'inet_pton(AF_INET6, "::ffff:127.0.0.1", &sin6_addr)}, 28) = 0\n'
                     '[pid 12] +++ exited with 0 +++\n')
            result, report = self.run_audit(Path(directory), trace)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(report['loopback_connections'], 2)
            self.assertEqual(report['checks']['external_connection_attempts'], 'passed')
            self.assertEqual(report['checks']['all_external_request_attempts'], 'unvalidated')

    def test_unreadable_or_missing_trace_cannot_reuse_a_pass(self):
        for trace in ('', 'private sentinel\n', 'connect(3, 0xdeadbeef, 16) = -1 EFAULT\n'):
            with self.subTest(trace=trace), tempfile.TemporaryDirectory() as directory:
                result, report = self.run_audit(Path(directory), trace)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn('passed', report['checks'].values())
                self.assertNotIn('private sentinel', json.dumps(report))

    def test_timeout_invalidates_old_evidence_without_retaining_command_text(self):
        with tempfile.TemporaryDirectory() as directory:
            result, report = self.run_audit(Path(directory), None, '--seconds', '0.1')
            self.assertEqual(result.returncode, 1)
            self.assertFalse(report['run_completed'])
            self.assertEqual(report['error_type'], 'TimeoutError')
            self.assertNotIn('passed', report['checks'].values())
            self.assertNotIn('private sentinel', json.dumps(report))

    def test_cli_usage_errors_invalidate_prior_passing_evidence(self):
        for options in (['--seconds', 'invalid'], ['--seconds'], ['--unknown']):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                result, report = self.run_audit(Path(directory), '', *options)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(report['run_completed'])
