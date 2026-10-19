"""Selected artifact validation through the production input verification boundary."""
from pathlib import Path
import tempfile
import unittest

from apps.audio.input import verify_input
from apps.audio.main import load_config


class InputVerificationTest(unittest.TestCase):
    def test_parakeet_checks_its_own_artifacts_without_requiring_whisper(self):
        with tempfile.TemporaryDirectory() as directory:
            config = load_config()
            config['stt'].update(model='parakeet-tdt-v3-int8', model_dir=directory)
            # The first selected artifact is present but corrupt. Requiring any
            # Whisper file instead would incorrectly report missing_input_model.
            Path(directory, 'encoder.int8.onnx').write_bytes(b'invalid synthetic model')
            with self.assertRaisesRegex(RuntimeError, '^input_checksum_mismatch$'):
                verify_input(config)

    def test_missing_models_and_unknown_selection_have_fixed_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            config = load_config()
            config['stt'].update(model='parakeet-tdt-v3-int8', model_dir=directory)
            with self.assertRaisesRegex(RuntimeError, '^missing_input_model$'):
                verify_input(config)
            config['stt']['model'] = 'private-unknown-model'
            with self.assertRaisesRegex(RuntimeError, '^unsupported_input_model$'):
                verify_input(config)
