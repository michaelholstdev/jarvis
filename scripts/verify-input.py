"""Opt-in synthetic German capture → STT → scripted synthesis/playback check.
Uses two temporary silent PipeWire sinks, never a physical microphone. No fixture on disk.
Run: .venv/bin/python scripts/verify-input.py VOICE.onnx INPUT_MODEL_DIRECTORY [OLLAMA_MODEL]
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.main import load_config  # noqa: E402
from apps.audio.output import Output, verify_voice  # noqa: E402
from apps.audio.input import verify_input  # noqa: E402


async def check(voice: str, models: str, ollama_model: str | None = None) -> None:
    import numpy as np
    import soxr
    from piper import PiperVoice
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
    chunks = [chunk.audio_float_array for chunk in speaker.synthesize('Was ist die Hauptstadt von Deutschland?')]
    samples = soxr.resample(np.concatenate(chunks), speaker.config.sample_rate, 48000)
    samples = np.concatenate((np.zeros(48000), samples, np.zeros(48000)))
    pcm = (samples * 32767).astype('<i2').tobytes()
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
            print(json.dumps({'event': 'synthetic_ollama_voice_loop_passed' if ollama_model else 'synthetic_core_voice_loop_passed',
                              'elapsed_ms': round((time.monotonic() - started) * 1000)}))
            await cli('mute')
            assert (await cli('unmute'))['state'] == 'idle'
        finally:
            for child in reversed(children):
                if child.returncode is None:
                    child.terminate()
                await child.wait()
            await asyncio.gather(*readers)
    # Check exact fixture recognition separately through the same public adapter.
    output = Output(config)
    try:
        await output.start()
        feeding = asyncio.create_task(feed())
        result = await output.run({'type': 'recognize', 'operation_id': 'fixture'})
        await feeding
        assert result['text'].casefold().strip(' .?!') == 'was ist die hauptstadt von deutschland'
        print('{"event":"synthetic_german_recognition_passed"}')
    finally:
        await output.stop()


if __name__ == '__main__':
    modules = []
    try:
        for name in ('jarvis_fixture_input', 'jarvis_fixture_output'):
            modules.append(subprocess.check_output([
                'pactl', 'load-module', 'module-null-sink', f'sink_name={name}', 'rate=48000'], text=True).strip())
        asyncio.run(check(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    finally:
        for module in reversed(modules):
            subprocess.run(['pactl', 'unload-module', module], check=True)
