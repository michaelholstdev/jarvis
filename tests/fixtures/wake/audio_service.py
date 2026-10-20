"""Real socket/worker/input stack with deterministic external audio/model packages."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
SOURCE = {'name': 'fixture', 'mute': False, 'sample_specification': 's16le 1ch 16000Hz',
          'properties': {'node.name': 'fixture'}}


def capture() -> None:
    import numpy as np
    Path(os.environ['WAKE_FIXTURE_PID']).write_text(str(os.getpid()))
    mode_file = os.environ.get('WAKE_FIXTURE_MODE')
    mode = Path(mode_file).read_text() if mode_file else 'endpoint'
    if mode == 'maximum':
        for _ in range(200):
            sys.stdout.buffer.write(np.full(320, 2000, dtype='<i2').tobytes())
            sys.stdout.buffer.flush()
            time.sleep(.02)
        time.sleep(60)
        return
    # More idle PCM than the pre-roll may retain; no speech can be decoded yet.
    block = np.full(512, -1000, dtype='<i2').tobytes()
    for _ in range(150):
        sys.stdout.buffer.write(block)
        sys.stdout.buffer.flush()
    while not Path(os.environ['WAKE_FIXTURE_TRIGGER']).exists():
        sys.stdout.buffer.write(block)
        sys.stdout.buffer.flush()
        time.sleep(.01)
    # Marker and immediate question have no silence between them. The detector
    # fires after question onset; only continuous buffered handoff can retain all.
    for value, samples in [(1000, 5120), (2000, 6400), (0, 16000)]:
        sys.stdout.buffer.write(np.full(samples, value, dtype='<i2').tobytes())
        sys.stdout.buffer.flush()
    time.sleep(60)


def boundaries(stack: ExitStack, config: dict) -> None:
    read_text = Path.read_text
    checksum = hashlib.sha256(b'fixture-model').hexdigest()

    def manifest(path, *args, **kwargs):
        if path == ROOT / 'config/models.json':
            return json.dumps({'models': [
                {'id': 'de_DE-thorsten-medium', 'sha256': checksum,
                 'config_sha256': hashlib.sha256(b'{}').hexdigest()},
                *({'id': name, 'local_path': name, 'sha256': checksum} for name in
                  ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt', 'silero_vad.onnx'])]})
        if path == ROOT / 'benchmarks/wake/artifacts.json':
            return json.dumps({name: {'sha256': checksum} for name in
                               ['hey_jarvis_v0.1.onnx', 'melspectrogram.onnx', 'embedding_model.onnx']})
        return read_text(path, *args, **kwargs)

    stack.enter_context(patch.object(Path, 'read_text', manifest))
    stack.enter_context(patch('subprocess.check_output', return_value=json.dumps([SOURCE]).encode()))


def worker() -> None:
    import numpy as np
    original_import = importlib.import_module
    popen = __import__('subprocess').Popen

    class Vad:
        def __init__(self, *args, **kwargs):
            self.active = False
        def reset(self):
            self.active = False
        def accept_waveform(self, samples):
            self.active = bool(np.any(samples > 0))
        def is_speech_detected(self):
            return self.active
        def empty(self):
            return True

    class Stream:
        result = SimpleNamespace(text='')
        def accept_waveform(self, rate, samples):
            question = np.count_nonzero(np.abs(samples - 2000 / 32768) < .00001)
            ambient = np.count_nonzero(samples < 0)
            self.result = SimpleNamespace(text='Wie spät ist es?' if question == 6400 and ambient < 12000 else 'CLIPPED_OR_UNBOUNDED')

    session = SimpleNamespace(get_providers=lambda: ['CPUExecutionProvider'])

    class WakeModel:
        def __init__(self, **kwargs):
            self.models = {'hey_jarvis_v0.1': session}
            self.preprocessor = SimpleNamespace(melspec_model=session, embedding_model=session)
        def reset(self):
            pass
        def predict(self, samples):
            return {'hey_jarvis_v0.1': .3 if np.any(samples > 1900) else 0}

    class Voice:
        def __init__(self, **kwargs):
            self.session = kwargs['session']
            self.config = SimpleNamespace(sample_rate=16000)
        def synthesize(self, text):
            yield SimpleNamespace(audio_float_array=np.ones(320, dtype=np.float32))

    packages = {
        'numpy': np,
        'soxr': SimpleNamespace(ResampleStream=lambda *a, **k: SimpleNamespace(resample_chunk=lambda x: np.tile(x, int(os.environ.get('WAKE_FIXTURE_RESAMPLE_MULTIPLIER', '1')) if os.environ.get('WAKE_FIXTURE_MODE') and Path(os.environ['WAKE_FIXTURE_MODE']).read_text() == 'maximum' else 1)), resample=lambda x, *a: x),
        'sherpa_onnx': SimpleNamespace(
            VadModelConfig=lambda: SimpleNamespace(silero_vad=SimpleNamespace()),
            VoiceActivityDetector=Vad,
            OfflineRecognizer=SimpleNamespace(from_whisper=lambda **kw: SimpleNamespace(create_stream=Stream, decode_stream=lambda s: None))),
        'openwakeword.model': SimpleNamespace(Model=WakeModel),
        'onnxruntime': SimpleNamespace(disable_telemetry_events=lambda: None, SessionOptions=SimpleNamespace, InferenceSession=lambda *a, **kw: session),
        'piper': SimpleNamespace(PiperVoice=Voice, PiperConfig=SimpleNamespace(from_dict=lambda x: {})),
    }
    def dependency(name, *args):
        return packages[name] if name in packages else original_import(name, *args)
    def spawn(*args, **kwargs):
        return popen([sys.executable, __file__, '--capture'], **kwargs)
    def version(name):
        return {'sherpa-onnx': '1.13.8', 'sherpa-onnx-core': '1.13.8',
                'piper-tts': '1.3.0', 'openwakeword': '0.6.0', 'onnxruntime': '1.31.0'}[name]
    pulse = Mock()
    pulse.pa_simple_new.return_value = 1
    pulse.pa_simple_write.return_value = 0
    pulse.pa_simple_drain.return_value = 0
    # Fault injection at the private worker pipe: production counters are still
    # measured normally; only the external transport drops/corrupts observations.
    original_stdout = sys.stdout
    class EvidencePipe:
        def write(self, value):
            if value.startswith('{'):
                event = json.loads(value)
                if event.get('event') == 'buffer_occupancy':
                    fault = os.environ.get('WAKE_FIXTURE_EVIDENCE_FAULT')
                    if fault == 'missing':
                        event['buffers'].pop('handoff', None)
                        value = json.dumps(event)
                    elif fault == 'stale':
                        for key, wrong in (('operation_id', 'old-operation'), ('generation', -1),
                                           ('capture_sequence', -1)):
                            stale = json.loads(value)
                            stale[key] = wrong
                            stale['buffers']['pre_roll']['high_water_bytes'] = 99999999
                            original_stdout.write(json.dumps(stale) + '\n')
            return original_stdout.write(value)
        def flush(self):
            original_stdout.flush()
    sys.stdout = EvidencePipe()
    with ExitStack() as stack:
        boundaries(stack, {})
        stack.enter_context(patch('importlib.import_module', side_effect=dependency))
        stack.enter_context(patch('importlib.metadata.version', side_effect=version))
        stack.enter_context(patch('subprocess.Popen', side_effect=spawn))
        stack.enter_context(patch('ctypes.CDLL', return_value=pulse))
        from apps.audio.output_worker import main
        main()


async def service() -> None:
    spawn = asyncio.create_subprocess_exec
    async def external_worker(*args, **kwargs):
        return await spawn(sys.executable, __file__, '--worker', **kwargs)
    with ExitStack() as stack:
        boundaries(stack, {})
        stack.enter_context(patch('asyncio.create_subprocess_exec', side_effect=external_worker))
        from apps.audio.main import serve
        await serve()


if __name__ == '__main__':
    if '--capture' in sys.argv:
        capture()
    elif '--worker' in sys.argv:
        worker()
    else:
        asyncio.run(service())
