"""Published report seam: independent known times and content-free output."""
import json
import unittest

from benchmarks.latency.report import summarize


class LatencyReportTest(unittest.TestCase):
    def test_nearest_rank_targets_include_every_attempt_and_keep_content_out(self):
        trials = [{'speech_end_ms': 100, 'signal_start_ms': 1100 + i * 100,
                   'text': 'private question', 'prompt': 'private answer'} for i in range(30)]
        report = summarize(trials)
        self.assertEqual(report['signal_latency_ms'], {'p50': 2400, 'p95': 3800})
        self.assertEqual(report['proxy_target'], 'failed')
        self.assertEqual(report['audible_target'], 'unvalidated')
        self.assertNotIn('private', json.dumps(report))
        self.assertEqual(report['attempts'], 30)
        self.assertEqual(report['completed'], 30)

    def test_failed_or_too_few_attempts_cannot_pass_by_dropping_samples(self):
        trials = [{'speech_end_ms': 10, 'signal_start_ms': 20}] * 30
        trials.append({'error': 'timeout'})
        report = summarize(trials)
        self.assertEqual(report['attempts'], 31)
        self.assertEqual(report['completed'], 30)
        self.assertEqual(report['proxy_target'], 'unvalidated')
        for bad in (-1, float('nan'), float('inf'), True, '20'):
            self.assertEqual(summarize([{'speech_end_ms': 10, 'signal_start_ms': bad}])['completed'], 0)
        self.assertEqual(summarize(trials[:29])['proxy_target'], 'unvalidated')
        self.assertEqual(summarize([{'speech_end_ms': 10, 'signal_start_ms': 20,
                                     'error': 'turn_failed'}])['completed'], 0)

    def test_regression_comparison_keeps_absolute_failure_and_requires_same_configuration(self):
        from benchmarks.latency.report import compare
        baseline = {'trials': [{'speech_end_ms': 0, 'signal_start_ms': n} for n in [2000] * 15 + [4000] * 15],
                    'model': {'digest': 'abc'}, 'config': {'llm': {'context': 2048}},
                    'scenario': {'warm': True}, 'runtimes': {'piper': '1'},
                    'summary': {'completed': 30, 'attempts': 30,
                                'proxy_target': 'failed', 'audible_target': 'unvalidated',
                                'signal_latency_ms': {'p50': 2000, 'p95': 4000}}}
        current = {**baseline, 'trials': [{'speech_end_ms': 0, 'signal_start_ms': n} for n in [2100] * 15 + [5000] * 15],
                   'summary': {**baseline['summary'],
                                         'signal_latency_ms': {'p50': 2100, 'p95': 5000}}}
        result = compare(baseline, current)
        self.assertEqual(result['regression'], 'failed')
        self.assertEqual(result['current_proxy_target'], 'failed')
        with self.assertRaises(ValueError):
            compare(baseline, {**current, 'model': {'digest': 'different'}})

        with self.assertRaises(ValueError):
            compare(baseline, {**current, 'summary': baseline['summary']})

    def test_benchmark_metadata_cannot_follow_a_redirect_outside_loopback(self):
        from email.message import Message
        import io
        from unittest.mock import patch
        from urllib.response import addinfourl
        from benchmarks.latency.run import ollama
        requests = []

        def http_open(handler, request):
            requests.append(request.full_url)
            headers = Message()
            headers['Location'] = 'http://example.invalid/metadata'
            response = addinfourl(io.BytesIO(b'{}'), headers, request.full_url,
                                  302 if len(requests) == 1 else 200)
            response.msg = 'Found'
            return response

        with patch('urllib.request.HTTPHandler.http_open', http_open):
            with self.assertRaises(ValueError):
                ollama('tags')
        self.assertEqual(requests, ['http://127.0.0.1:11434/api/tags'])

    def test_published_idle_resource_samples_exclude_active_run_and_teardown(self):
        from pathlib import Path
        from benchmarks.latency.resources import summarize_resources
        for name in ('gemma3-270m', 'llama3-8b'):
            with self.subTest(configuration=name):
                report = json.loads(Path(f'benchmarks/latency/{name}.json').read_text())
                phases = report['resource_samples']
                self.assertLess(phases['idle'][-1]['monotonic_ms'],
                                phases['active'][0]['monotonic_ms'])
                for phase, rows in phases.items():
                    self.assertEqual(report['resources'][phase], summarize_resources(rows))


class MeasurementLifecycleTest(unittest.IsolatedAsyncioTestCase):
    async def test_published_measurements_are_frozen_before_services_teardown(self):
        import asyncio
        import os
        from benchmarks.latency.measurements import Measurements
        reader = asyncio.StreamReader()
        measurements = Measurements(os.getpid(), [reader])
        await asyncio.sleep(0)
        measurements.begin_active()
        reader.feed_data(b'{"event":"endpoint","operation_id":"turn","monotonic_ms":10}\n')
        await asyncio.sleep(.11)
        await measurements.stop()
        report = measurements.report()
        self.assertGreater(len(report['resource_samples']['idle']), 0)
        self.assertGreater(len(report['resource_samples']['active']), 0)
        self.assertEqual(report['events'], [{'event': 'endpoint', 'operation_id': 'turn',
                                            'monotonic_ms': 10}])
        frozen = json.dumps(report, sort_keys=True)
        reader.feed_data(b'{"event":"interruption","monotonic_ms":100}\n')
        reader.feed_eof()
        await asyncio.sleep(.11)
        self.assertEqual(json.dumps(measurements.report(), sort_keys=True), frozen)
        for phase, rows in report['resource_samples'].items():
            self.assertEqual(report['resources'][phase]['samples'], len(rows))
        self.assertLess(report['resource_samples']['idle'][-1]['monotonic_ms'],
                        report['resource_samples']['active'][0]['monotonic_ms'])

    async def test_failed_or_closed_diagnostic_stream_cannot_publish_a_report(self):
        import asyncio
        import os
        from benchmarks.latency.measurements import Measurements
        for malformed in (True, False):
            with self.subTest(malformed=malformed):
                reader = asyncio.StreamReader()
                measurements = Measurements(os.getpid(), [reader])
                await asyncio.sleep(0)
                if malformed:
                    reader.feed_data(b'private diagnostic that is not JSON\n')
                else:
                    reader.feed_eof()
                await asyncio.sleep(0)
                await measurements.stop()
                with self.assertRaisesRegex(RuntimeError, '^measurement_collection_failed$'):
                    measurements.report()

    async def test_sampler_failure_after_valid_samples_cannot_publish_zero_vram_pass(self):
        import asyncio
        import os
        from unittest.mock import patch
        from benchmarks.latency.measurements import Measurements
        measurements = Measurements(os.getpid(), [])
        await asyncio.sleep(0)
        with patch('pathlib.Path.iterdir', side_effect=PermissionError('private diagnostic')):
            await asyncio.sleep(.11)
        with self.assertRaisesRegex(RuntimeError, '^measurement_collection_failed$'):
            measurements.check()
        await measurements.stop()
        with self.assertRaisesRegex(RuntimeError, '^measurement_collection_failed$'):
            measurements.report()
