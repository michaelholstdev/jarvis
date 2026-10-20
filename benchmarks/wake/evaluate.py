"""Evaluate a pinned openWakeWord candidate on explicitly supplied 16 kHz WAVs.

No ambient capture, transcription, playback or model downloading occurs here.
This detector-only screen cannot establish production handoff/acoustic acceptance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from typing import Any
import wave

HERE = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def write_report(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def corpus_trials(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text())
    if (not isinstance(data, dict) or data.get('run_completed') is False
            or not isinstance(data.get('trials'), list) or not data['trials']):
        raise ValueError('invalid_corpus')
    trials = data['trials']
    seen: set[str] = set()
    for trial in trials:
        if (not isinstance(trial, dict) or not isinstance(trial.get('id'), str)
                or not trial['id'] or trial['id'] in seen
                or not isinstance(trial.get('condition'), str) or not trial['condition']
                or type(trial.get('intended_wake')) is not bool
                or not isinstance(trial.get('path'), str)
                or not isinstance(trial.get('sha256'), str)):
            raise ValueError('invalid_corpus')
        seen.add(trial['id'])
        if trial['intended_wake']:
            window = trial.get('wake_window_ms')
            if (not isinstance(window, list) or len(window) != 2
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in window)
                    or not 0 <= window[0] < window[1]):
                raise ValueError('invalid_corpus')
    return list(trials)


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    trials = corpus_trials(args.corpus)
    try:
        threshold = float(args.threshold)
    except ValueError:
        raise ValueError('invalid_threshold') from None
    if not math.isfinite(threshold) or not 0 < threshold < 1:
        raise ValueError('invalid_threshold')
    from importlib.metadata import version
    expected_ort = '1.31.0' if sys.version_info >= (3, 11) else '1.23.2'
    if version('openwakeword') != '0.6.0' or version('onnxruntime') != expected_ort:
        raise ValueError('unsupported_runtime')
    inventory = json.loads((HERE / 'artifacts.json').read_text())
    for name, artifact in inventory.items():
        if digest(args.models / name) != artifact['sha256']:
            raise ValueError('model_checksum_mismatch')
    import numpy as np
    import onnxruntime as ort
    from openwakeword.model import Model
    ort.disable_telemetry_events()
    model = Model(wakeword_models=[str(args.models / 'hey_jarvis_v0.1.onnx')],
                  inference_framework='onnx',
                  melspec_model_path=str(args.models / 'melspectrogram.onnx'),
                  embedding_model_path=str(args.models / 'embedding_model.onnx'))
    sessions = [*model.models.values(), model.preprocessor.melspec_model,
                model.preprocessor.embedding_model]
    if any(session.get_providers() != ['CPUExecutionProvider'] for session in sessions):
        raise ValueError('cpu_required')
    rows = []
    for trial in trials:
        path = args.corpus.parent / trial['path']
        if digest(path) != trial['sha256']:
            raise ValueError('audio_checksum_mismatch')
        with wave.open(str(path), 'rb') as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate(),
                    source.getcomptype()) != (1, 2, 16000, 'NONE'):
                raise ValueError('unsupported_audio')
            frames = source.getnframes()
            # Stream files, with only one 80 ms input frame retained at a time.
            # A two-hour negative run need not fit in RAM.
            if not frames or frames > 16000 * 4 * 3600:
                raise ValueError('invalid_audio_duration')
            duration_ms = frames / 16
            if trial['intended_wake'] and trial['wake_window_ms'][1] > duration_ms:
                raise ValueError('invalid_wake_window')
            model.reset()
            detections = []
            maximum = 0.0
            processed = 0
            last_detection = -2000.0
            inference_ms = 0.0
            while block := source.readframes(1280):
                if len(block) % 2:
                    raise ValueError('truncated_audio')
                actual = len(block) // 2
                samples = np.frombuffer(block, dtype='<i2')
                if actual < 1280:
                    samples = np.pad(samples, (0, 1280 - actual))
                started = time.monotonic()
                score = float(model.predict(samples)['hey_jarvis_v0.1'])
                inference_ms += (time.monotonic() - started) * 1000
                if not math.isfinite(score) or not 0 <= score <= 1:
                    raise ValueError('invalid_model_score')
                maximum = max(maximum, score)
                processed += actual
                timestamp = processed / 16
                if score >= threshold and timestamp - last_detection >= 2000:
                    detections.append(timestamp)
                    last_detection = timestamp
            if processed != frames:
                raise ValueError('truncated_audio')
            intended = trial['intended_wake']
            matching = ([value for value in detections
                         if trial['wake_window_ms'][0] <= value <= trial['wake_window_ms'][1]]
                        if intended else [])
            rows.append({'id': trial['id'], 'condition': trial['condition'],
                         'intended_wake': intended, 'audio_sha256': trial['sha256'],
                         'audio_seconds': frames / 16000, 'detected': bool(matching),
                         'false_activations': len(detections) - min(1, len(matching)),
                         'detection_audio_ms': matching[0] if matching else None,
                         'max_score': maximum, 'inference_ms': inference_ms})
    groups = {}
    for condition in sorted({row['condition'] for row in rows}):
        subset = [row for row in rows if row['condition'] == condition]
        positives = [row for row in subset if row['intended_wake']]
        negatives = [row for row in subset if not row['intended_wake']]
        detected = sum(row['detected'] for row in positives)
        negative_seconds = sum(row['audio_seconds'] for row in negatives)
        false_activations = sum(row['false_activations'] for row in subset)
        groups[condition] = {'attempts': len(positives), 'detected': detected,
                             'recall': detected / len(positives) if positives else None,
                             'negative_recordings': len(negatives),
                             'negative_seconds': negative_seconds,
                             'false_activations': false_activations}
    screen_passed = all(group['attempts'] >= 30 and group['negative_recordings'] >= 30
                        and group['recall'] >= .95 and group['false_activations'] == 0
                        for group in groups.values())
    return {'run_completed': True, 'screen_passed': screen_passed,
            'acceptance_passed': False,
            'scope': 'detector-only candidate measurements; no production enablement verdict',
            'screen_criteria': 'per supplied condition: >=30 positives, >=30 negatives, '
                               'recall >=0.95, zero false activations; not acoustic acceptance',
            'threshold': threshold, 'frame_samples': 1280, 'refractory_ms': 2000,
            'corpus_sha256': digest(args.corpus), 'artifacts': inventory,
            'lock_sha256': digest(HERE.parents[1] / 'uv.lock'),
            'runtime': {'openwakeword': version('openwakeword'),
                        'onnxruntime': version('onnxruntime'), 'numpy': version('numpy'),
                        'provider': 'CPUExecutionProvider'},
            'handoff_latency_ms': None, 'command_clipping': None,
            'groups': groups, 'trials': rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threshold', required=True)
    args = parser.parse_args()
    failed: dict[str, Any] = {'run_completed': False, 'screen_passed': False,
                              'acceptance_passed': False}
    # Invalidate old evidence before loading files, optional dependencies or models.
    write_report(args.output, failed)
    try:
        report = evaluate(args)
    except (OSError, ValueError, RuntimeError, ImportError, wave.Error) as error:
        allowed = {'invalid_corpus', 'invalid_threshold', 'unsupported_runtime',
                   'model_checksum_mismatch', 'audio_checksum_mismatch', 'unsupported_audio',
                   'invalid_audio_duration', 'invalid_wake_window', 'cpu_required',
                   'invalid_model_score', 'truncated_audio'}
        failed['error'] = str(error) if str(error) in allowed else 'evaluation_failed'
        write_report(args.output, failed)
        return 2
    write_report(args.output, report)
    return 0


if __name__ == '__main__':
    sys.exit(main())
