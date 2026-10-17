"""Opt-in CPU recognizer comparison. Reads only fixed synthetic WAVs; no capture."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import time
from typing import Any
import wave

from benchmarks.recognition.prepare import HERE, digest, write_json
from benchmarks.recognition.scoring import report

PARAKEET = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
WHISPER = 'sherpa-onnx-whisper-tiny'


def hardware() -> dict[str, Any]:
    def read(path: str) -> str:
        try:
            return Path(path).read_text().strip()
        except OSError:
            return 'unavailable'
    cpu = read('/proc/cpuinfo')
    return {
        'platform': platform.platform(), 'python': platform.python_version(),
        'cpu': next((line.split(':', 1)[1].strip() for line in cpu.splitlines()
                     if line.startswith('model name')), 'unavailable'),
        'logical_cpus': os.cpu_count(), 'affinity': sorted(os.sched_getaffinity(0)),
        'memory': read('/proc/meminfo'), 'loadavg': read('/proc/loadavg'),
        'governors': {str(p): p.read_text().strip() for p in
                      Path('/sys/devices/system/cpu').glob('cpu*/cpufreq/scaling_governor')},
        'gpu_total_used_bytes': {str(p): p.read_text().strip() for p in
                                Path('/sys/class/drm').glob('card*/device/mem_info_vram_used')},
        'ollama_processes': subprocess.check_output(
            ['ps', '-C', 'ollama', '-o', 'comm=,pcpu=,rss='], text=True).strip()
            if subprocess.run(['pgrep', '-x', 'ollama'], stdout=subprocess.DEVNULL).returncode == 0
            else 'none',
        'load_condition': 'Uncontrolled logged-in desktop; no deliberate Ollama generation. GPU values include all applications.',
    }


def load_engine(name: str, directory: Path) -> Any:
    if name == 'vosk':
        from vosk import Model, SetLogLevel
        SetLogLevel(-1)
        return Model(str(directory / 'vosk-model-small-de-0.15'))
    import sherpa_onnx as sherpa
    if version('sherpa-onnx') != '1.13.8' or version('sherpa-onnx-core') != '1.13.8':
        raise ValueError('Unsupported sherpa runtime')
    if name == 'whisper':
        from apps.audio.input import WhisperRecognizer
        return WhisperRecognizer({'stt': {'model_dir': str(directory / WHISPER)}}, sherpa)
    model = directory / PARAKEET
    return sherpa.OfflineRecognizer.from_transducer(
        encoder=str(model / 'encoder.int8.onnx'), decoder=str(model / 'decoder.int8.onnx'),
        joiner=str(model / 'joiner.int8.onnx'), tokens=str(model / 'tokens.txt'),
        model_type='nemo_transducer', num_threads=2, provider='cpu', decoding_method='greedy_search')


def recognize(name: str, engine: Any, pcm: bytes) -> dict[str, Any]:
    import numpy as np
    first_partial = None
    finalization_ms = None
    started = time.perf_counter()
    if name == 'vosk':
        from vosk import KaldiRecognizer
        stream = KaldiRecognizer(engine, 16000)
        completed = []
        for offset in range(0, len(pcm), 640):  # 20 ms; unpaced compute, no artificial sleep
            if stream.AcceptWaveform(pcm[offset:offset + 640]):
                completed.append(json.loads(stream.Result())['text'])
            elif first_partial is None and json.loads(stream.PartialResult()).get('partial'):
                first_partial = min(offset + 640, len(pcm)) / 32
        final_started = time.perf_counter()
        completed.append(json.loads(stream.FinalResult())['text'])
        finalization_ms = (time.perf_counter() - final_started) * 1000
        text = ' '.join(completed).strip()
    else:
        samples = np.frombuffer(pcm, dtype='<i2').astype('float32') / 32768
        if name == 'whisper':
            text = engine.recognize(samples)
        else:
            stream = engine.create_stream()
            stream.accept_waveform(16000, samples)
            engine.decode_stream(stream)
            text = stream.result.text.strip()
    return {'hypothesis': text, 'decode_ms': (time.perf_counter() - started) * 1000,
            'first_partial_audio_offset_ms': first_partial, 'finalization_ms': finalization_ms}


def run(name: str, directory: Path, output: Path, repeats: int) -> None:
    inventory = json.loads((directory / 'verified-models.json').read_text())
    prefix = {'parakeet': PARAKEET, 'whisper': WHISPER, 'vosk': 'vosk-model-small-de-0.15'}[name]
    files = {n: h for n, h in inventory['files'].items() if n.startswith(prefix + '/')}
    if not files:
        raise ValueError('No verified models; run prepare first')
    for path, expected in files.items():
        if digest(directory / path) != expected:
            raise ValueError(f'Checksum mismatch: {path}')
    corpus = json.loads((directory / 'corpus/manifest.json').read_text())
    if corpus['source_sha256'] != digest(HERE / 'corpus.json'):
        raise ValueError('Corpus references changed; regenerate audio')
    audio = []
    for row in corpus['utterances']:
        path = directory / 'corpus' / f"{row['id']}.wav"
        if digest(path) != row['sha256']:
            raise ValueError(f"Corrupt corpus: {row['id']}")
        with wave.open(str(path)) as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise ValueError('Expected 16 kHz mono PCM16')
            pcm = wav.readframes(wav.getnframes())
        audio.append((row, pcm))
    before = hardware()
    started = time.perf_counter()
    engine = load_engine(name, directory)
    load_ms = (time.perf_counter() - started) * 1000
    cold = recognize(name, engine, audio[0][1])
    rows = []
    cpu_started = time.process_time()
    wall_started = time.perf_counter()
    for repeat in range(repeats):
        for row, pcm in audio:
            result = recognize(name, engine, pcm)
            rows.append({**row, **result, 'repeat': repeat + 1})
    result = {
        'configuration': name, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
        'settings': {'provider': 'cpu', 'threads': 2 if name != 'vosk' else 'Vosk default (not configured)',
                     'decoding': 'greedy_search' if name == 'parakeet' else
                     'Whisper language=de task=transcribe' if name == 'whisper' else 'Vosk default',
                     'behavior': 'true partial streaming, unpaced 20 ms input' if name == 'vosk'
                     else 'whole-utterance endpointed; no partials',
                     'quantization': 'INT8 ONNX encoder/decoder/joiner' if name == 'parakeet' else
                     'INT8 ONNX encoder/decoder' if name == 'whisper' else 'upstream small model; not ONNX INT8',
                     'repeats': repeats, 'vad': 'excluded; presegmented WAV; no endpoint silence wait'},
        'runtimes': {p: version(p) for p in ('sherpa-onnx', 'sherpa-onnx-core', 'vosk',
                                            'piper-tts', 'soxr', 'numpy')},
        'lockfile_sha256': digest(Path('uv.lock')),
        'artifacts': inventory['artifacts'], 'model_files': files, 'corpus': corpus,
        'hardware_before': before, 'hardware_after': hardware(),
        'model_load_ms': load_ms, 'first_decode': cold,
        'measurement_cpu_seconds': time.process_time() - cpu_started,
        'measurement_wall_seconds': time.perf_counter() - wall_started,
        'peak_process_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'summary': report(rows), 'measurements': rows,
    }
    write_json(output, result)
    print(json.dumps({'configuration': name, 'summary': result['summary']}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('configuration', choices=['whisper', 'parakeet', 'vosk'])
    parser.add_argument('directory', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--repeats', type=int, default=3)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error('--repeats must be positive')
    run(args.configuration, args.directory, args.output, args.repeats)
