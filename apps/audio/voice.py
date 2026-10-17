"""Pinned CPU Piper settings shared by production and resource benchmarks."""
from __future__ import annotations

import importlib
from importlib.metadata import version
import json
from pathlib import Path
from typing import Any


def load_cpu_voice(model_path: str) -> Any:
    if version('piper-tts') != '1.3.0':
        raise RuntimeError('unsupported_runtime')
    piper = importlib.import_module('piper')
    ort = importlib.import_module('onnxruntime')
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    session = ort.InferenceSession(model_path, sess_options=options, providers=['CPUExecutionProvider'])
    voice = piper.PiperVoice(session=session, config=piper.PiperConfig.from_dict(
        json.loads(Path(model_path + '.json').read_text())))
    if voice.session.get_providers() != ['CPUExecutionProvider']:
        raise RuntimeError('cpu_required')
    return voice
