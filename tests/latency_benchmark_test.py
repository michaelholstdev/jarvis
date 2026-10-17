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
