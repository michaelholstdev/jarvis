"""Content-explicit, offline benchmark scoring; never used by routine logging."""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Sequence


def normalize(text: str) -> str:
    """NFC, lowercase, punctuation to spaces; preserve umlauts, ß and numbers."""
    return ' '.join(re.sub(r'[^\w\s]', ' ', unicodedata.normalize('NFC', text).lower()).split())


def distance(reference: Sequence[str], hypothesis: Sequence[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, expected in enumerate(reference, 1):
        current = [i]
        for j, actual in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def percentile(values: list[float], fraction: float) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def score(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        raise ValueError('No measurements')
    words = errors = characters = character_errors = exact = 0
    for row in rows:
        reference, hypothesis = normalize(row['reference']), normalize(row['hypothesis'])
        words += len(reference.split())
        errors += distance(reference.split(), hypothesis.split())
        characters += len(reference)
        character_errors += distance(reference, hypothesis)
        exact += reference == hypothesis
    return {
        'utterances': len(rows), 'distinct_utterances': len({r['id'] for r in rows}), 'reference_words': words, 'word_errors': errors,
        'wer': errors / words if words else None,
        'cer': character_errors / characters if characters else None,
        'exact_match_rate': exact / len(rows),
        'decode_ms_p50': percentile([r['decode_ms'] for r in rows], .5),
        'decode_ms_p95': percentile([r['decode_ms'] for r in rows], .95),
        'rtf': sum(r['decode_ms'] for r in rows) / 1000 / sum(r['audio_seconds'] for r in rows),
    }


GATE = {'minimum_core_utterances': 30, 'standard_wer_max': .15,
        'technical_wer_max': .25, 'decode_ms_p95_max': 1000, 'rtf_max': 1}


def report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    groups = {group: score([r for r in rows if r['group'] == group])
              for group in sorted({r['group'] for r in rows})}
    core_rows = [r for r in rows if r['group'] in {'standard', 'technical'}]
    core = score(core_rows) if core_rows else None
    passed = bool(core and len({r['id'] for r in core_rows}) >= GATE['minimum_core_utterances']
                  and all(group in groups and groups[group]['wer'] is not None
                          and groups[group]['wer'] <= GATE[f'{group}_wer_max']
                          for group in ('standard', 'technical'))
                  and core['decode_ms_p95'] <= GATE['decode_ms_p95_max']
                  and core['rtf'] <= GATE['rtf_max'])
    return {'core': core, 'groups': groups,
            'quality_gate': {'thresholds': GATE, 'passed': passed,
                             'scope': 'synthetic screening only; acoustic acceptance unvalidated'}}
