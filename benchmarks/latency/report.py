"""Nearest-rank signal latency; incomplete trials never make a passing run."""
from __future__ import annotations

import math
from typing import Any


def summarize(trials: list[dict[str, Any]]) -> dict[str, Any]:
    values = sorted(t['signal_start_ms'] - t['speech_end_ms'] for t in trials
                    if not t.get('error') and all(type(t.get(k)) in (int, float) and math.isfinite(t[k])
                           for k in ('signal_start_ms', 'speech_end_ms'))
                    and t['signal_start_ms'] >= t['speech_end_ms'])
    percentiles = ({f'p{p}': values[math.ceil(len(values) * p / 100) - 1]
                    for p in (50, 95)} if values else None)
    eligible = len(values) >= 30 and len(values) == len(trials)
    return {'attempts': len(trials), 'completed': len(values),
            'signal_latency_ms': percentiles,
            'proxy_target': ('unvalidated' if not eligible else
                             'passed' if percentiles and percentiles['p50'] <= 1500
                             and percentiles['p95'] <= 3000 else 'failed'),
            'audible_target': 'unvalidated'}


def compare(baseline: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    import copy
    baseline, current = copy.deepcopy(baseline), copy.deepcopy(current)
    for report in (baseline, current):
        if summarize(report['trials']) != report['summary']:
            raise ValueError('Summary disagrees with raw trials')
        if not report['model'].get('digest'):
            raise ValueError('Missing model digest')
        if report.get('run_completed') is False:
            raise ValueError('Incomplete run')
        if report['scenario'].get('device') == 'two_silent_pipewire_sinks':
            for device in ('input_device', 'output_device'):
                report['config']['audio'][device] = '<private_benchmark_sink>'
    for field in ('model', 'config', 'scenario', 'runtimes', 'speech_models', 'uv_lock_sha256',
                  'cases_sha256', 'measurement'):
        # Ignore model installation timestamps/metadata; the digest is its identity.
        expected = baseline[field].get('digest') if field == 'model' else baseline.get(field)
        actual = current[field].get('digest') if field == 'model' else current.get(field)
        if expected != actual:
            raise ValueError(f'Incomparable {field}; use the same baseline configuration')
    first, second = baseline['summary'], current['summary']
    eligible = all(s['completed'] == s['attempts'] and s['completed'] >= 30
                   and s['signal_latency_ms'] is not None for s in (first, second))
    ratios = ({p: second['signal_latency_ms'][p] / first['signal_latency_ms'][p]
               for p in ('p50', 'p95')} if eligible else None)
    return {'regression': ('unvalidated' if ratios is None else
                           'failed' if any(r > 1.2 for r in ratios.values()) else 'passed'),
            'limit_ratio': 1.2, 'ratios': ratios,
            'current_proxy_target': second['proxy_target'], 'audible_target': 'unvalidated'}


if __name__ == '__main__':
    import argparse
    import json
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Compare matching signal-proxy regression reports')
    parser.add_argument('baseline', type=Path)
    parser.add_argument('current', type=Path)
    args = parser.parse_args()
    try:
        result = compare(json.loads(args.baseline.read_text()), json.loads(args.current.read_text()))
    except (ValueError, KeyError, TypeError, AttributeError, ZeroDivisionError):
        parser.exit(2, 'invalid_or_incomparable_report\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['regression'] == 'passed' else 1)
