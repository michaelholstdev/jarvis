"""Independent capture evidence at the playback probe's audio boundary."""
import unittest


class DeliveryProbeTest(unittest.TestCase):
    def setUp(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest('install --extra output for independent PCM evidence checks')

    def test_premature_sentence_report_is_rejected_even_if_audio_arrives_later(self):
        import numpy as np
        from scripts.delivery_evidence import verify_prefix

        # Known source PCM, independent of any delivery event. Distinct continuous
        # signals represent two already synthesized sentences at the audio boundary.
        rate = 1000
        source = np.random.default_rng(7)
        first = source.integers(-10000, 10000, 1000, dtype=np.int16).tobytes()
        second = source.integers(-10000, 10000, 1390, dtype=np.int16).tobytes()
        before = bytes(200)
        at_report = before + first + second[:900 * 2]
        with self.assertRaisesRegex(AssertionError, 'unobserved sentence PCM'):
            verify_prefix(at_report, [first, second], rate)
        # Later PCM cannot retroactively validate the earlier snapshot.
        verify_prefix(before + first + second, [first, second], rate)
        with self.assertRaisesRegex(AssertionError, 'unobserved sentence PCM'):
            verify_prefix(at_report, [first, second], rate)

    def test_capture_requires_the_expected_waveform_and_allows_only_fixed_capture_lag(self):
        import numpy as np
        from scripts.delivery_evidence import verify_prefix

        reference = np.random.default_rng(12).integers(-10000, 10000, 1000, dtype=np.int16).tobytes()
        verify_prefix(bytes(200) + reference[:-20 * 2], [reference], 1000)
        with self.assertRaisesRegex(AssertionError, 'unobserved sentence PCM'):
            verify_prefix(bytes(200) + reference[:-21 * 2], [reference], 1000)
        with self.assertRaisesRegex(AssertionError, 'unobserved sentence PCM'):
            verify_prefix(bytes(2200), [reference], 1000)
