"""Explicitly acquire the candidate, or generate a German synthetic screening set."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
from typing import Any
import wave

from benchmarks.wake.evaluate import HERE, digest

QUESTIONS = [
    'wie spät ist es?',
    'erkläre mir den Unterschied zwischen RAM und VRAM.',
    'was bedeutet CPU auf Deutsch?',
    'wie funktioniert PipeWire?',
    'nenne drei Vorteile von Linux.',
    'was ist ein Git Commit?',
    'erkläre mir einen HTTP Timeout.',
    'wie berechnet man sieben mal acht?',
    'was bedeutet Stopp auf Englisch?',
    'warum ist der Himmel blau?',
]


def download(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    inventory = json.loads((HERE / 'artifacts.json').read_text())
    for name, artifact in inventory.items():
        path = directory / name
        if not path.exists():
            subprocess.run(['curl', '--fail', '--location', '--retry', '2',
                            artifact['url'], '-o', str(path)], check=True)
        if digest(path) != artifact['sha256']:
            raise ValueError('model_checksum_mismatch')


def synthesize(directory: Path, voice_path: Path) -> None:
    import numpy as np
    from piper import SynthesisConfig
    import soxr
    from apps.audio.voice import load_cpu_voice

    root = HERE.parents[1]
    inventory = json.loads((root / 'config/models.json').read_text())
    expected = next(row for row in inventory['models'] if row['id'] == 'de_DE-thorsten-medium')
    if (digest(voice_path) != expected['sha256']
            or digest(Path(str(voice_path) + '.json')) != expected['config_sha256']):
        raise ValueError('voice_checksum_mismatch')
    voice = load_cpu_voice(str(voice_path))
    directory.mkdir(parents=True, exist_ok=True)
    trials = []
    # Three rates of one synthetic speaker are a screen, not 30 independent humans.
    for index, length_scale in enumerate((.9, 1., 1.1)):
        settings = SynthesisConfig(noise_scale=0, noise_w_scale=0, length_scale=length_scale)
        for number, question in enumerate(QUESTIONS):
            for label, prefix in (('positive', 'Hey Jarvis, '), ('negative', ''),
                                  ('jasper', 'Hey Jasper, '), ('travis', 'Hey Travis, ')):
                intended = label == 'positive'
                identifier = f'{label}-{index}-{number:02}'
                text = prefix + question
                chunks = [chunk.audio_float_array for chunk in voice.synthesize(
                    text, syn_config=settings)]
                speech = soxr.resample(np.concatenate(chunks), voice.config.sample_rate, 16000)
                samples = np.concatenate((np.zeros(16000), speech, np.zeros(16000)))
                pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
                path = directory / f'{identifier}.wav'
                with wave.open(str(path), 'wb') as target:
                    target.setnchannels(1)
                    target.setsampwidth(2)
                    target.setframerate(16000)
                    target.writeframes(pcm)
                row: dict[str, Any] = {'id': identifier, 'condition': 'synthetic-quiet',
                       'intended_wake': intended, 'path': path.name, 'sha256': digest(path)}
                if intended:
                    # Generous whole-speech window: success cannot establish prompt
                    # detection or preservation of the immediate question.
                    row['wake_window_ms'] = [1000, 1000 + len(speech) / 16]
                trials.append(row)
    manifest = {'kind': 'single-speaker-synthetic-screen',
                'voice_sha256': expected['sha256'],
                'voice_config_sha256': expected['config_sha256'],
                'synthesis': {'piper': '1.3.0', 'length_scales': [.9, 1., 1.1],
                              'noise_scale': 0, 'noise_w_scale': 0,
                              'padding_ms': 1000, 'sample_rate': 16000},
                'label_scope': 'whole-speech window; no precise wake/command boundary labels',
                'trials': trials}
    (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', type=Path, default=Path('models/wake'))
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--corpus', type=Path)
    parser.add_argument('--voice', type=Path, default=Path('models/benchmark/de_DE-thorsten-medium.onnx'))
    args = parser.parse_args()
    if args.download:
        download(args.models)
    if args.corpus:
        synthesize(args.corpus, args.voice)
    if not args.download and not args.corpus:
        parser.error('select --download and/or --corpus')
