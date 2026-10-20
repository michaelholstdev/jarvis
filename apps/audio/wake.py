"""Pinned experimental CPU wake detector. Loading never acquires artifacts."""
from __future__ import annotations

import hashlib
import importlib
from importlib.metadata import version
import json
import math
from pathlib import Path
import sys
from typing import Any


class WakeDetector:
    def __init__(self, config: dict[str, Any]) -> None:
        expected_ort = '1.31.0' if sys.version_info >= (3, 11) else '1.23.2'
        if version('openwakeword') != '0.6.0' or version('onnxruntime') != expected_ort:
            raise RuntimeError('unsupported_wake_runtime')
        root = Path(__file__).resolve().parents[2]
        classifier = Path(config['wake_word']['model_path'] or 'models/wake/hey_jarvis_v0.1.onnx')
        if classifier.name != 'hey_jarvis_v0.1.onnx':
            raise RuntimeError('unsupported_wake_model')
        inventory = json.loads((root / 'benchmarks/wake/artifacts.json').read_text())
        for name, artifact in inventory.items():
            path = classifier.parent / name
            if not path.is_file():
                raise RuntimeError('missing_wake_model')
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
            if digest.hexdigest() != artifact['sha256']:
                raise RuntimeError('wake_checksum_mismatch')
        ort = importlib.import_module('onnxruntime')
        ort.disable_telemetry_events()
        model = importlib.import_module('openwakeword.model').Model
        self.model = model(wakeword_models=[str(classifier)], inference_framework='onnx',
                           melspec_model_path=str(classifier.parent / 'melspectrogram.onnx'),
                           embedding_model_path=str(classifier.parent / 'embedding_model.onnx'))
        sessions = [*self.model.models.values(), self.model.preprocessor.melspec_model,
                    self.model.preprocessor.embedding_model]
        if any(session.get_providers() != ['CPUExecutionProvider'] for session in sessions):
            raise RuntimeError('wake_cpu_required')
        self.threshold = float(config['wake_word']['threshold'])

    def reset(self) -> None:
        self.model.reset()

    def detected(self, samples: Any) -> bool:
        score = float(self.model.predict(samples)['hey_jarvis_v0.1'])
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise RuntimeError('invalid_wake_score')
        return score >= self.threshold
