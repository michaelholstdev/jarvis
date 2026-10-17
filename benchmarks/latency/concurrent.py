"""Separate CPU speech stress workload: simultaneous STT/TTS, never a live microphone."""
from __future__ import annotations

import argparse
import json
import os
import select
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from apps.audio.input import Input, verify_input
from apps.audio.main import load_config
from apps.audio.output import verify_voice
from benchmarks.latency.resources import snapshot, summarize_resources
from benchmarks.latency.run import ollama
from benchmarks.recognition.prepare import write_json
from benchmarks.recognition.run import hardware


def worker(kind: str, voice: Path, directory: Path) -> None:
    import numpy as np
    import onnxruntime as ort
    ort.disable_telemetry_events()
    config = load_config()
    config['tts']['model_path'] = str(voice)
    config['stt']['model_dir'] = str(directory)
    verify_input(config)
    verify_voice(config)
    engine: Any
    if kind == 'stt':
        engine = Input(config).recognizer
        # Identical public synthetic fixture every run; decoding silence is not a
        # representative concurrent speech workload.
        from piper import PiperVoice
        import soxr
        speaker = PiperVoice.load(str(voice), use_cuda=False)
        audio = np.concatenate([c.audio_float_array for c in speaker.synthesize(
            'Was ist die Hauptstadt von Deutschland?')])
        samples = soxr.resample(audio, speaker.config.sample_rate, 16000)
        del speaker
    else:
        from piper import PiperVoice
        from piper import PiperConfig
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        session = ort.InferenceSession(str(voice), sess_options=options, providers=['CPUExecutionProvider'])
        engine = PiperVoice(session=session, config=PiperConfig.from_dict(
            json.loads(Path(str(voice) + '.json').read_text())))
    print('ready', flush=True)
    sys.stdin.readline()
    end = time.monotonic() + 10
    iterations = 0
    while time.monotonic() < end:
        if kind == 'stt':
            engine.recognize(samples)
        else:
            for chunk in engine.synthesize('Berlin ist die Hauptstadt von Deutschland.'):
                pass
            del chunk
        iterations += 1
    print(json.dumps({'iterations': iterations}), flush=True)
    sys.stdin.readline()  # keep residency through the final resource sample


def run(args: argparse.Namespace) -> None:
    children = []
    phases: dict[str, list[dict[str, Any]]] = {'idle': [], 'concurrent': []}
    before = hardware()
    try:
        for kind in ('stt', 'tts'):
            child = subprocess.Popen([sys.executable, '-m', 'benchmarks.latency.concurrent',
                                      '--worker', kind, '--voice', str(args.voice.resolve()),
                                      '--input-dir', str(args.input_dir.resolve())],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            children.append(child)
            assert child.stdout
            if not select.select([child.stdout], [], [], 40)[0] or child.stdout.readline().strip() != 'ready':
                raise RuntimeError('worker_start_failed')
        for phase, seconds in (('idle', 3), ('concurrent', 10.5)):
            if phase == 'concurrent':
                for child in children:
                    assert child.stdin
                    child.stdin.write('go\n')
                    child.stdin.flush()
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                phases[phase].append(snapshot(os.getpid()))
                time.sleep(.1)
        iterations = []
        for child in children:
            assert child.stdout
            if not select.select([child.stdout], [], [], 40)[0]:
                raise RuntimeError('worker_completion_timeout')
            iterations.append(json.loads(child.stdout.readline()))
        write_json(args.output, {'workload': 'separate-process CPU STT/TTS stress; not daemon scheduling',
                                'hardware_before': before, 'hardware_after': hardware(),
                                'speech_models': json.loads(Path('config/models.json').read_text()),
                                'settings': {'provider': 'CPU', 'threads': 2, 'duration_seconds': 10,
                                             'fixture': 'synthetic German capital question',
                                             'tts_voice': 'de_DE-thorsten-medium'},
                                'ollama': ollama('ps'), 'iterations': iterations,
                                'resources': {k: summarize_resources(v) for k, v in phases.items()},
                                'samples': phases})
    finally:
        for child in children:
            child.terminate()
            child.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice', required=True, type=Path)
    parser.add_argument('--input-dir', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--worker', choices=['stt', 'tts'])
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.voice, args.input_dir)
    elif args.output:
        run(args)
    else:
        parser.error('--output required')
