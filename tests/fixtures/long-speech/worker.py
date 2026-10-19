"""Run the production worker with deterministic external Piper/Pulse dependencies."""
import ctypes
import importlib.metadata
import os
import runpy
import subprocess
import sys
import time
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np


class Voice:
    def __init__(self, session, config):
        self.session, self.config = session, config

    def synthesize(self, text):
        # The synthetic regression sentence takes 3.286 s, as in the real repro.
        # Reserve a deliberately slow eight-second full-text notice.
        seconds = 8 if text.startswith('Die Antwort ist zu lang') else 3.286
        if text.startswith('LANGER_SATZ'):
            seconds = 70
        for _ in range(int(seconds * 1000)):
            yield SimpleNamespace(audio_float_array=np.zeros(16, dtype=np.float32))


sys.modules['piper'] = SimpleNamespace(
    PiperVoice=Voice,
    PiperConfig=SimpleNamespace(from_dict=lambda _: SimpleNamespace(sample_rate=16000)),
)
sys.modules['onnxruntime'] = SimpleNamespace(
    disable_telemetry_events=lambda: None,
    SessionOptions=SimpleNamespace,
    InferenceSession=lambda *_, **__: SimpleNamespace(get_providers=lambda: ['CPUExecutionProvider']),
)
sys.modules['soxr'] = SimpleNamespace(resample=lambda samples, *_: samples)
importlib.metadata.version = lambda _: '1.3.0'
sink = {'name': 'fixture', 'mute': False, 'sample_specification': 's16le 1ch 16000Hz'}
subprocess.check_output = lambda *_, **__: __import__('json').dumps([sink]).encode()
pulse = Mock()
pulse.pa_simple_new.return_value = 1
pulse.pa_simple_drain.return_value = 0
written = 0
drained = 0


def drain(*_):
    global drained
    drained += 1
    return 0


def write(_stream, _pcm, size, _error):
    global written
    if drained and os.environ.get('JARVIS_TEST_BLOCK_PLAYBACK') == '1':
        time.sleep(30)
    written += size
    if written > 16000 * 2 * 60:
        raise RuntimeError('fixture_playback_exceeded_60_seconds')
    return 0


pulse.pa_simple_write.side_effect = write
pulse.pa_simple_drain.side_effect = drain
ctypes.CDLL = lambda _: pulse
sys.path.insert(0, 'apps/audio')
runpy.run_path('apps/audio/output_worker.py', run_name='__main__')
