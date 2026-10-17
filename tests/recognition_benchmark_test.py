"""Agreed seam: public benchmark scoring/report API, no model mocks."""
import unittest

from benchmarks.recognition.scoring import score


class RecognitionComparisonTest(unittest.TestCase):
    def test_counts_recognition_errors_without_erasing_german_spelling(self):
        result = score([
            {'id': 'a', 'group': 'standard', 'reference': 'Die Straße ist lang.',
             'hypothesis': 'die strasse ist sehr lang', 'decode_ms': 100, 'audio_seconds': 2},
            {'id': 'b', 'group': 'technical', 'reference': 'Starte Docker bitte',
             'hypothesis': 'starte bitte', 'decode_ms': 200, 'audio_seconds': 1},
        ])
        self.assertEqual(result['word_errors'], 3)
        self.assertEqual(result['reference_words'], 7)
        self.assertAlmostEqual(result['wer'], 3 / 7)
        self.assertEqual(result['exact_match_rate'], 0)
        self.assertEqual(result['decode_ms_p95'], 200)
        self.assertAlmostEqual(result['rtf'], .1)

    def test_reports_capability_probes_separately_and_never_passes_on_them(self):
        from benchmarks.recognition.scoring import report
        rows = [
            {'id': str(i), 'group': 'standard' if i < 20 else 'technical',
             'reference': 'Hallo Welt', 'hypothesis': 'Hallo Welt',
             'decode_ms': 100, 'audio_seconds': 1}
            for i in range(30)
        ]
        rows.append({'id': 'dialect', 'group': 'dialect', 'reference': 'Grüß dich',
                     'hypothesis': '', 'decode_ms': 4000, 'audio_seconds': 1})
        result = report(rows)
        self.assertTrue(result['quality_gate']['passed'])
        self.assertEqual(result['core']['wer'], 0)
        self.assertEqual(result['groups']['dialect']['wer'], 1)
        self.assertFalse(report(rows[:20])['quality_gate']['passed'])
        rows[0]['hypothesis'] = 'falsch ' * 100
        self.assertFalse(report(rows)['quality_gate']['passed'])

    def test_repeated_measurements_cannot_substitute_for_thirty_distinct_utterances(self):
        from benchmarks.recognition.scoring import report
        rows = [{'id': 'one', 'group': 'standard', 'reference': 'Hallo',
                 'hypothesis': 'Hallo', 'decode_ms': 10, 'audio_seconds': 1}] * 30
        rows += [{'id': 'two', 'group': 'technical', 'reference': 'Docker',
                  'hypothesis': 'Docker', 'decode_ms': 10, 'audio_seconds': 1}] * 30
        self.assertFalse(report(rows)['quality_gate']['passed'])
