"""Control-recognition seam: explicit intent and acoustic echo veto."""
import unittest

from apps.audio.stop_control import accepts_stop


class StopControlTest(unittest.TestCase):
    def test_only_complete_standalone_non_echo_stop_is_accepted(self):
        self.assertTrue(accepts_stop(' STOPP! ', 'Eine Antwort.', endpoint=True, echo=False))
        for text in ('', '„Stopp“', '"Stopp"', 'Was bedeutet Stopp?', 'Stopp bitte', 'Stopp, danach weiter'):
            self.assertFalse(accepts_stop(text, 'Eine Antwort.', endpoint=True, echo=False))
        self.assertFalse(accepts_stop('Stopp', 'Eine Antwort.', endpoint=False, echo=False))
        self.assertFalse(accepts_stop('Stopp', 'Eine Antwort.', endpoint=True, echo=True))
        self.assertFalse(accepts_stop('Stopp', 'Das Wort lautet Stopp.', endpoint=True, echo=False))

    def test_delayed_scaled_playback_is_echo_but_independent_voice_is_not(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest('install --extra input for acoustic correlation fixtures')
        from apps.audio.stop_control import is_echo
        rng = np.random.default_rng(14)
        reference = rng.normal(0, .1, 32000).astype('float32')
        # Known sample offset represents acoustic/driver delay; gain is immaterial.
        echo = reference[8000:16000] * .2
        self.assertTrue(is_echo(echo, reference, np))
        self.assertFalse(is_echo(rng.normal(0, .1, 8000), reference, np))

    def test_continuation_after_truncated_capture_never_becomes_standalone_stop(self):
        from apps.audio.stop_control import ControlBoundary
        first = ControlBoundary(11)
        for _ in range(12):
            first.accept(False)
        self.assertTrue(first.accept(True))  # Was bedeutet ... until capture cap
        second = ControlBoundary(11)
        # ... Stopp? in the new capture window is still the same question.
        for _ in range(20):
            self.assertFalse(second.accept(True))
        for _ in range(11):
            self.assertFalse(second.accept(False))
        self.assertTrue(second.accept(True))  # A new utterance after genuine silence.

    def test_disabled_control_never_invokes_recognition(self):
        from apps.audio.main import load_config
        from apps.audio.stop_control import StopMonitor
        opened = []
        class NoCapture:
            def recognize(self, *args):
                opened.append(True)
                raise AssertionError('disabled control opened capture')
        config = load_config()
        config['audio']['mode'] = 'voice'
        monitor = StopMonitor(config, NoCapture(), [], 'Antwort.', lambda *_: None)
        monitor.close()
        self.assertEqual(opened, [])
        config['features']['voice_stop'] = True
        monitor = StopMonitor(config, NoCapture(), [], 'Sage Stopp.', lambda *_: None)
        monitor.close()
        self.assertEqual(opened, [])

    def test_playback_completion_waits_for_control_capture_cleanup(self):
        import threading
        from apps.audio.main import load_config
        from apps.audio.stop_control import StopMonitor
        started = threading.Event()
        cleaned = threading.Event()
        class Capture:
            def recognize(self, emit, cancelled, reference):
                started.set()
                cancelled.wait(2)
                cleaned.set()
                return {'text': '', 'endpoint': False, 'echo': False}
        config = load_config()
        config['audio']['mode'] = 'voice'
        config['features']['voice_stop'] = True
        monitor = StopMonitor(config, Capture(), [], 'Antwort.', lambda *_: None)
        try:
            self.assertTrue(started.wait(2))
        finally:
            monitor.close()
        self.assertTrue(cleaned.is_set())

    def test_control_recognition_failure_preserves_manual_playback(self):
        import threading
        from apps.audio.main import load_config
        from apps.audio.stop_control import StopMonitor
        class FailedRecognition:
            def recognize(self, *args):
                raise OSError('device lost')
        unavailable = threading.Event()
        config = load_config()
        config['audio']['mode'] = 'voice'
        config['features']['voice_stop'] = True
        monitor = StopMonitor(config, FailedRecognition(), [], 'Antwort.', lambda event: unavailable.set() if event == 'voice_stop_unavailable' else None)
        try:
            self.assertTrue(unavailable.wait(2))
        finally:
            monitor.close()
