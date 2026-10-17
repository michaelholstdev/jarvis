"""Explicit download/verification and deterministic synthetic corpus generation."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import wave
import zipfile

HERE = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def prepare(directory: Path, download: bool) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    artifacts = json.loads((HERE / 'artifacts.json').read_text())
    # Verify every source before extracting or loading any model.
    for name, artifact in artifacts.items():
        path = directory / name
        if download and not path.exists():
            subprocess.run(['curl', '--fail', '--location', '--retry', '2',
                            artifact['url'], '-o', str(path)], check=True)
        if digest(path) != artifact['sha256']:
            raise ValueError(f'Checksum mismatch: {name}')
    for name in ('parakeet.tar.bz2', 'whisper.tar.bz2'):
        with tarfile.open(directory / name) as archive:
            # Copy only required regular model files; never extract links or paths.
            for entry in archive:
                path = Path(entry.name)
                if (entry.isfile() and not path.is_absolute() and '..' not in path.parts
                        and len(path.parts) == 2 and
                        (path.name.endswith('.int8.onnx') or path.name.endswith('tokens.txt'))):
                    source = archive.extractfile(entry)
                    assert source is not None
                    target = directory / path
                    target.parent.mkdir(exist_ok=True)
                    target.write_bytes(source.read())
    with zipfile.ZipFile(directory / 'vosk.zip') as archive:
        for zip_entry in archive.infolist():
            path = Path(zip_entry.filename)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
            if not zip_entry.is_dir():
                target = directory / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(zip_entry))
    files = {str(p.relative_to(directory)): digest(p) for p in sorted(directory.rglob('*'))
             if p.is_file() and (p.suffix in {'.onnx', '.txt'} or 'vosk-model-small-de-0.15' in p.parts)}
    files['de_DE-thorsten-medium.onnx.json'] = digest(directory / 'de_DE-thorsten-medium.onnx.json')
    write_json(directory / 'verified-models.json', {'artifacts': artifacts, 'files': files})


def synthesize(directory: Path) -> None:
    import numpy as np
    from piper import PiperVoice, SynthesisConfig
    import soxr
    inventory = json.loads((directory / 'verified-models.json').read_text())
    for name in ('de_DE-thorsten-medium.onnx', 'de_DE-thorsten-medium.onnx.json'):
        if digest(directory / name) != inventory['files'][name]:
            raise ValueError(f'Checksum mismatch: {name}')
    voice = PiperVoice.load(str(directory / 'de_DE-thorsten-medium.onnx'), use_cuda=False)
    settings = SynthesisConfig(noise_scale=0, noise_w_scale=0, length_scale=1)
    corpus = json.loads((HERE / 'corpus.json').read_text())
    output = directory / 'corpus'
    output.mkdir(exist_ok=True)
    for row in corpus['utterances']:
        chunks = [c.audio_float_array for c in voice.synthesize(row['reference'], syn_config=settings)]
        samples = soxr.resample(np.concatenate(chunks), voice.config.sample_rate, 16000)
        pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
        path = output / f"{row['id']}.wav"
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(pcm)
        row.update(sha256=digest(path), audio_seconds=len(pcm) / 32000)
    corpus.update(source_sha256=digest(HERE / 'corpus.json'),
                  synthesis={'voice_sha256': inventory['files']['de_DE-thorsten-medium.onnx'],
                             'noise_scale': 0, 'noise_w_scale': 0, 'length_scale': 1,
                             'pcm': '16 kHz mono signed 16-bit, soxr resampling; no added silence'})
    write_json(output / 'manifest.json', corpus)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--synthesize', action='store_true')
    args = parser.parse_args()
    prepare(args.directory, args.download)
    if args.synthesize:
        synthesize(args.directory)
