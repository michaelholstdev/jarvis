"""Opt-in synthetic German capture → STT → scripted synthesis/playback check.
Uses two temporary silent PipeWire sinks, never a physical microphone. No fixture on disk.
Run: .venv/bin/python scripts/verify-input.py VOICE.onnx INPUT_MODEL_DIRECTORY [OLLAMA_MODEL]
"""
from __future__ import annotations

import argparse
import asyncio
import copy
from contextlib import redirect_stdout
from importlib.metadata import version
import io
import platform
import hashlib
import resource
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.main import load_config  # noqa: E402
from apps.audio.output import Output, OutputError, verify_voice  # noqa: E402
from apps.audio.input import verify_input  # noqa: E402


async def check(voice: str, models: str, ollama_model: str | None = None) -> dict:
    import numpy as np
    import soxr
    from piper import PiperVoice, SynthesisConfig
    config = load_config()
    config['audio'].update(mode='voice', input_device='jarvis_fixture_input.monitor',
                           output_device='jarvis_fixture_output')
    config['tts']['model_path'] = str(Path(voice).resolve())
    config['stt']['model_dir'] = str(Path(models).resolve())
    config['vad']['max_utterance_seconds'] = 10
    if ollama_model is not None:
        config['llm'].update(mode='ollama', model=ollama_model)
    verify_voice(config)
    verify_input(config)
    # Fixed synthetic German question with independent expected recognition.
    speaker = PiperVoice.load(voice, use_cuda=False)
    chunks = [chunk.audio_float_array for chunk in speaker.synthesize(
        'Was ist die Hauptstadt von Deutschland?',
        syn_config=SynthesisConfig(noise_scale=0, noise_w_scale=0, length_scale=1))]
    samples = soxr.resample(np.concatenate(chunks), speaker.config.sample_rate, 48000)
    samples = np.concatenate((np.zeros(48000), samples, np.zeros(48000)))
    pcm = (samples * 32767).astype('<i2').tobytes()
    fixture_sha256 = hashlib.sha256(pcm).hexdigest()
    del speaker, chunks, samples

    async def feed() -> None:
        await asyncio.sleep(.5)
        child = await asyncio.create_subprocess_exec(
            'pw-play', '--target', 'jarvis_fixture_input', '--rate', '48000',
            '--channels', '1', '--format', 's16', '--raw', '-', stdin=-1, stdout=-3, stderr=-3)
        await child.communicate(pcm)
        assert child.returncode == 0

    with tempfile.TemporaryDirectory(prefix='jv-in-') as directory:
        config_path = Path(directory) / 'config.json'
        config_path.write_text(json.dumps(config))
        env = {**os.environ, 'PULSE_SERVER': os.environ.get('PULSE_SERVER', f"unix:{os.environ['XDG_RUNTIME_DIR']}/pulse/native"),
               'PIPEWIRE_RUNTIME_DIR': os.environ['XDG_RUNTIME_DIR'], 'XDG_RUNTIME_DIR': directory, 'JARVIS_CONFIG': str(config_path)}
        children = []
        logs = bytearray()
        async def consume(stream: asyncio.StreamReader) -> None:
            while line := await stream.readline():
                logs.extend(line)
        readers = []
        async def cli(*args: str) -> dict:
            child = await asyncio.create_subprocess_exec('node', 'dist/apps/core/main.js', *args, env=env, stdout=-1, stderr=-1)
            stdout, stderr = await asyncio.wait_for(child.communicate(), 20)
            assert child.returncode == 0, stderr
            return json.loads(stdout)
        try:
            for command in ((sys.executable, 'apps/audio/main.py'), ('node', 'dist/apps/core/main.js', 'start')):
                child = await asyncio.create_subprocess_exec(*command, env=env, stdout=-1, stderr=-1)
                children.append(child)
                assert child.stdout and child.stderr
                while True:
                    line = await asyncio.wait_for(child.stdout.readline(), 30)
                    logs.extend(line)
                    if b'service_started' in line:
                        break
                    if not line:
                        raise AssertionError(await child.stderr.read())
                readers.extend([asyncio.create_task(consume(child.stdout)), asyncio.create_task(consume(child.stderr))])
            health = await cli('health')
            assert health['capabilities']['stt'] == 'ready'
            if ollama_model is not None:
                assert health['capabilities']['inference'] == 'ready'
            started = time.monotonic()
            await cli('activate')
            feeding = asyncio.create_task(feed())
            for _ in range(5000 if ollama_model is not None else 300):
                status = await cli('health')
                reply_played = any(json.loads(line).get('event') == 'playback_completed' and
                                   json.loads(line).get('delivered_chars', 0) > 0
                                   for line in logs.splitlines())
                if reply_played and (status['state'] == 'follow-up' or ollama_model is not None):
                    break
                if status['last_failure']:
                    raise AssertionError(status['last_failure'])
                await asyncio.sleep(.05)
            else:
                raise AssertionError('voice turn did not finish')
            await feeding
            await cli('mute')
            assert b'speech_started' in logs and b'recognition_final' in logs
            assert b'playback_completed' in logs
            assert b'Wie' not in logs and b'simulierte Antwort' not in logs
            turn_ms = round((time.monotonic() - started) * 1000)
            print(json.dumps({'event': 'synthetic_ollama_voice_loop_passed' if ollama_model else 'synthetic_core_voice_loop_passed',
                              'elapsed_ms': turn_ms}))
            assert (await cli('unmute'))['state'] == 'idle'
        finally:
            for child in reversed(children):
                if child.returncode is None:
                    child.terminate()
                await child.wait()
            await asyncio.gather(*readers)
    # Check exact fixture recognition separately through the same public adapter.
    output = Output(config)
    barrier_ms = {}
    try:
        await output.start()
        feeding = asyncio.create_task(feed())
        result = await output.run({'type': 'recognize', 'operation_id': 'fixture'})
        await feeding
        assert result['text'].casefold().strip(' .?!') == 'was ist die hauptstadt von deutschland'
        print('{"event":"synthetic_german_recognition_passed"}')
        # Stop during actual capture; reject both an in-flight result and work
        # admitted before the barrier. No waveform or transcript may cross it.
        for kind in ('cancel', 'privacy'):
            if output.process is None:
                await output.start()
            speech = asyncio.Event()
            pending = asyncio.create_task(output.run(
                {'type': 'recognize', 'operation_id': kind + '-fixture'}, speech.set))
            feeding = asyncio.create_task(feed())
            try:
                await asyncio.wait_for(speech.wait(), 10)
                stale = output.run({'type': 'recognize', 'operation_id': 'stale'})
                started = time.monotonic()
                await output.run({'type': kind, 'operation_id': kind})
                response = await asyncio.wait_for(pending, 2)
                assert 'text' not in response
                try:
                    await stale
                except OutputError:
                    pass
                else:
                    raise AssertionError('stale recognition admitted after barrier')
                assert output.process is None
                barrier_ms[kind] = round((time.monotonic() - started) * 1000)
                print(json.dumps({'event': 'synthetic_' + kind + '_passed',
                                  'elapsed_ms': barrier_ms[kind]}))
            finally:
                if not pending.done():
                    await output.stop()
                await asyncio.gather(pending, feeding, return_exceptions=True)
        # Exercise content-free startup diagnostics through the real worker,
        # without replacing the selected recognizer with a working alternative.
        with tempfile.TemporaryDirectory(prefix='jv-invalid-input-') as missing:
            broken = copy.deepcopy(config)
            broken['stt']['model_dir'] = missing
            for corrupt in (False, True):
                if corrupt:
                    filename = ('encoder.int8.onnx' if config['stt']['model'] == 'parakeet-tdt-v3-int8'
                                else 'tiny-encoder.int8.onnx')
                    Path(missing, filename).write_bytes(b'invalid synthetic model')
                failing = Output(broken)
                try:
                    diagnostic = io.StringIO()
                    try:
                        with redirect_stdout(diagnostic):
                            await failing.start()
                    except OutputError as error:
                        assert str(error) == 'output_runtime_unavailable'
                        assert json.loads(diagnostic.getvalue()) == {
                            'event': 'audio_diagnostic',
                            'code': 'input_checksum_mismatch' if corrupt else 'missing_input_model'}
                    else:
                        raise AssertionError('invalid model silently substituted')
                finally:
                    await failing.stop()
        print('{"event":"synthetic_invalid_artifacts_rejected"}')
    finally:
        await output.stop()

    events = [json.loads(line) for line in logs.splitlines()]
    manifest = json.loads(Path('config/models.json').read_text())
    return {'schema_version': 1,
            'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
            'revision_note': 'working tree implementation; use commit containing this report',
            'python': platform.python_version(), 'system': platform.platform(),
            'cpu': next(line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),
            'runtimes': {name: version(name) for name in ('sherpa-onnx', 'sherpa-onnx-core', 'piper-tts', 'soxr', 'numpy')},
            'uv_lock_sha256': hashlib.sha256(Path('uv.lock').read_bytes()).hexdigest(),
            'model_manifest_sha256': hashlib.sha256(Path('config/models.json').read_bytes()).hexdigest(),
            'input_artifacts': [model for model in manifest['models'] if model['role'] == 'vad' or
                                (model['role'] == 'stt' and model['id'].startswith('parakeet-') ==
                                 (config['stt']['model'] == 'parakeet-tdt-v3-int8'))],
            'vad': config['vad'], 'barrier_ms': barrier_ms,
            'recognizer': config['stt']['model'], 'provider': 'cpu', 'threads': 2,
            'fixture_pcm_sha256': fixture_sha256,
            'synthesis': {'noise_scale': 0, 'noise_w_scale': 0, 'length_scale': 1},
            'scripted_turn_ms': turn_ms,
            'events': [event for event in events if event.get('event') in
                       {'speech_started', 'endpoint', 'recognition_final'}],
            'checks': ['core_voice_loop', 'exact_german_recognition', 'cancel', 'privacy',
                       'stale_admission', 'missing_artifacts', 'corrupt_artifacts'],
            'acoustic_acceptance': 'unvalidated'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('voice')
    parser.add_argument('models')
    parser.add_argument('ollama_model', nargs='?')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    modules = []
    started = time.monotonic()
    try:
        for name in ('jarvis_fixture_input', 'jarvis_fixture_output'):
            modules.append(subprocess.check_output([
                'pactl', 'load-module', 'module-null-sink', f'sink_name={name}', 'rate=48000'], text=True).strip())
        report = asyncio.run(check(args.voice, args.models, args.ollama_model))
    finally:
        for module in reversed(modules):
            subprocess.run(['pactl', 'unload-module', module], check=True)
    own, children = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
    report['resources'] = {
        'wall_seconds': round(time.monotonic() - started, 3),
        'self_cpu_seconds': round(own.ru_utime + own.ru_stime, 3),
        'reaped_children_cpu_seconds': round(children.ru_utime + children.ru_stime, 3),
        'self_peak_rss_mib': round(own.ru_maxrss / 1024, 1),
        'largest_reaped_child_peak_rss_mib': round(children.ru_maxrss / 1024, 1),
        'scope': 'whole check including model reloads, synthesis, CLI polling and failed loads; not idle or simultaneous total RSS',
    }
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + '\n')
