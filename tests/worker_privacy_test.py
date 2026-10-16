"""Resident worker privacy checked through its stdin protocol and audio dependencies."""
import gc
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import weakref

from apps.audio.main import load_config
from apps.audio.output_worker import main


class WorkerPrivacyTest(unittest.TestCase):
    def test_speech_waveforms_are_released_before_waiting_idle_after_closure(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest('install --extra output for worker waveform lifecycle checks')
        import importlib
        live_samples = []

        class SpeechSamples(np.ndarray):
            def __array_finalize__(self, original):
                live_samples.append(weakref.ref(self))

        class Voice:
            def __init__(self, session, config):
                self.session, self.config = session, config

            def synthesize(self, text):
                yield SimpleNamespace(audio_float_array=np.ones(320, dtype=np.float32).view(SpeechSamples))

        original_frombuffer = np.frombuffer
        original_import = importlib.import_module
        dependencies = {
            'numpy': np,
            'soxr': SimpleNamespace(resample=lambda audio, *_: audio),
            'piper': SimpleNamespace(PiperVoice=Voice, PiperConfig=SimpleNamespace(from_dict=lambda _: SimpleNamespace(sample_rate=16000))),
            'onnxruntime': SimpleNamespace(disable_telemetry_events=lambda: None, SessionOptions=SimpleNamespace,
                                          InferenceSession=lambda *_, **__: SimpleNamespace(get_providers=lambda: ['CPUExecutionProvider'])),
        }

        def dependency(name, *args):
            return dependencies[name] if name in dependencies else original_import(name, *args)

        test_case = self

        class WorkerInput(io.StringIO):
            def __next__(self):
                line = self.readline()
                if line:
                    return line
                # Observe release while main() is still resident at its next
                # protocol read, rather than after its stack has been destroyed.
                gc.collect()
                test_case.assertTrue(live_samples, 'fixture must have produced speech')
                test_case.assertFalse(any(sample() is not None for sample in live_samples),
                                      'private speech waveform survived conversation closure')
                raise StopIteration

        with tempfile.TemporaryDirectory() as directory:
            config = load_config()
            config['tts']['model_path'] = str(Path(directory) / 'voice.onnx')
            Path(config['tts']['model_path'] + '.json').write_text('{}')
            config['audio'].update(mode='piper', output_device='fixture')
            operations = [
                config,
                {'type': 'synthesize', 'text': 'Hallo. Ungehört.'},
                {'type': 'play', 'text': 'Hallo. Ungehört.'},
                {'type': 'close-conversation', 'sound': False},
            ]
            source = WorkerInput(''.join(json.dumps(operation) + '\n' for operation in operations))
            pulse = Mock()
            pulse.pa_simple_new.return_value = 1
            pulse.pa_simple_write.return_value = 0
            pulse.pa_simple_drain.return_value = 0
            sink = {'name': 'fixture', 'mute': False, 'sample_specification': 's16le 1ch 16000Hz'}
            with (patch('sys.stdin', source), patch('sys.stdout', io.StringIO()),
                  patch('importlib.metadata.version', return_value='1.3.0'),
                  patch('subprocess.check_output', return_value=json.dumps([sink]).encode()),
                  patch('ctypes.CDLL', return_value=pulse),
                  patch('numpy.frombuffer', side_effect=lambda *args, **kwargs: original_frombuffer(*args, **kwargs).view(SpeechSamples)),
                  patch('importlib.import_module', side_effect=dependency)):
                main()
