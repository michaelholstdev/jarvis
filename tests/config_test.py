"""Public audio configuration loader checks; no hardware or sockets."""

import os
import json
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from apps.audio.main import Diagnostic, load_config


class AudioConfigurationTest(unittest.TestCase):
    def test_both_services_apply_yaml_12_scalars_consistently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            path.write_text(
                "transport:\n  timeout_ms: 01000\naudio:\n  input_device: on\n  pre_roll_ms: 0750\n"
                "stt:\n  model: parakeet-tdt-v3-int8\ntts:\n  voice: 1_000\nllm:\n  model: 0b1000\n"
            )
            with patch.dict(os.environ, {"JARVIS_CONFIG": str(path)}):
                audio = load_config()
                result = subprocess.run(
                    ["node", "dist/apps/core/main.js", "config"],
                    capture_output=True, text=True, check=True,
                )
            core = json.loads(result.stdout)
            self.assertEqual(audio["transport"]["timeout_ms"], 1000)
            self.assertEqual(audio["audio"]["pre_roll_ms"], 750)
            self.assertEqual(audio["audio"]["input_device"], "on")
            self.assertEqual(audio["stt"]["model"], "parakeet-tdt-v3-int8")
            self.assertEqual(audio["tts"]["voice"], "1_000")
            self.assertEqual(audio["llm"]["model"], "0b1000")
            self.assertEqual(audio, core)

    def test_unknown_recognizer_is_rejected_by_both_services(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.yaml'
            path.write_text('stt:\n  model: private-unknown-model')
            with patch.dict(os.environ, {'JARVIS_CONFIG': str(path)}):
                with self.assertRaisesRegex(Diagnostic, 'invalid_config: /stt/model enum'):
                    load_config()
                result = subprocess.run(
                    ['node', 'dist/apps/core/main.js', 'config'], capture_output=True, text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('private-unknown-model', result.stderr)

    def test_empty_config_has_cpu_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}, clear=True):
                config = load_config()
        self.assertEqual(config["session"]["follow_up_seconds"], 20)
        self.assertEqual(config["stt"]["device"], "cpu")
        self.assertIs(config["features"]["external_tools"], False)

    def test_experimental_wake_defaults_and_disable_match_core_cli(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            for wake in ({}, {"enabled": False}, {"threshold": .3},
                         {"model_path": "/private/candidate.onnx"},
                         {"model_path": None, "threshold": None}):
                path.write_text(json.dumps({"audio": {"mode": "voice"}, "wake_word": wake}))
                with patch.dict(os.environ, {"JARVIS_CONFIG": str(path)}):
                    audio = load_config()
                    result = subprocess.run(
                        ["node", "dist/apps/core/main.js", "config"],
                        capture_output=True, text=True, check=True,
                    )
                self.assertEqual(audio, json.loads(result.stdout))
                self.assertEqual(audio["wake_word"]["enabled"], wake.get("enabled", True))
                self.assertEqual(audio["wake_word"]["threshold"], wake.get("threshold") or .2)

    def test_invalid_configuration_is_content_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            for content in (
                "llm:\n  base_url: https://private.example/secret",
                "session:\n  follow_up_seconds: 61",
                "features:\n  external_tools: true",
                "logging:\n  content_logging: off",
                "audio:\n  1: secret",
                "wake_word:\n  threshold: 1",
                "wake_word:\n  threshold: .nan",
                "unknown: secret",
                "llm:\n  base_url: http://127.0.0.1:65536",
                "session:\n  follow_up_seconds: 5\n  follow_up_seconds: 60",
            ):
                with self.subTest(content=content):
                    path.write_text(content)
                    with patch.dict(os.environ, {"JARVIS_CONFIG": str(path)}):
                        with self.assertRaises(Diagnostic) as error:
                            load_config()
                        self.assertTrue(str(error.exception).startswith("invalid_config:"))
                        self.assertNotIn("secret", str(error.exception))


if __name__ == "__main__":
    unittest.main()
