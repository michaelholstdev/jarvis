"""Agreed seam: benchmark CLI rejects invalid corpus before inference."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import wave


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'benchmarks/recognition/corpus.json'


class RecognitionCorpusTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='jarvis-corpus-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        corpus_directory = self.directory / 'corpus'
        corpus_directory.mkdir()
        self.corpus = json.loads(SOURCE.read_text())
        self.corpus['source_sha256'] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        for row in self.corpus['utterances']:
            path = corpus_directory / f"{row['id']}.wav"
            with wave.open(str(path), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(16000)
                wav.writeframes(b'\0\0' * 160)
            row.update(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), audio_seconds=.01)
        # No real model is needed: invalid corpus must be rejected before loading it.
        model = self.directory / 'sherpa-onnx-whisper-tiny/placeholder'
        model.parent.mkdir()
        model.write_bytes(b'not an inference model')
        (self.directory / 'verified-models.json').write_text(json.dumps({
            'files': {'sherpa-onnx-whisper-tiny/placeholder':
                      hashlib.sha256(model.read_bytes()).hexdigest()}, 'artifacts': {},
        }))

    def assert_rejected(self, message):
        (self.directory / 'corpus/manifest.json').write_text(json.dumps(self.corpus))
        output = self.directory / 'result.json'
        completed = subprocess.run(
            [sys.executable, '-m', 'benchmarks.recognition.run', 'whisper',
             str(self.directory), str(output), '--repeats', '1'],
            cwd=ROOT, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn(message, completed.stderr)
        self.assertFalse(output.exists())

    def test_rejects_rewritten_reference_with_unchanged_source_and_wave_hashes(self):
        self.corpus['utterances'][0]['reference'] = 'A replacement that would hide recognition errors'
        self.assert_rejected('Corpus metadata mismatch')

    def test_rejects_inflated_duration_instead_of_lowering_real_time_factor(self):
        self.corpus['utterances'][0]['audio_seconds'] = 10000
        self.assert_rejected('Corpus duration mismatch')

    def test_rejects_changed_groups_and_missing_duplicate_or_extra_utterances(self):
        original = json.dumps(self.corpus)
        for change in ('group', 'id', 'missing', 'duplicate', 'extra'):
            with self.subTest(change=change):
                self.corpus = json.loads(original)
                rows = self.corpus['utterances']
                if change == 'group':
                    rows[0]['group'] = 'dialect'
                elif change == 'id':
                    rows[0]['id'] = '../outside-corpus'
                elif change == 'missing':
                    rows.pop()
                elif change == 'duplicate':
                    rows[-1] = rows[0]
                else:
                    rows.append(rows[0])
                self.assert_rejected('Corpus metadata mismatch')
