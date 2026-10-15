"""Opt-in real Piper/PulseAudio integration. Uses an ephemeral silent 48 kHz sink.
Run after `uv sync --extra output`: .venv/bin/python scripts/verify-output.py MODEL.onnx
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.audio.output import Output, verify_voice  # noqa: E402


async def check(model: str, device: str) -> None:
    from apps.audio.main import load_config
    config = load_config()
    config['audio'].update(mode='piper', output_device=device)
    config['tts']['model_path'] = str(Path(model).resolve())
    verify_voice(config)
    output = Output(config)
    try:
        await output.start()
        result = await output.run({'type': 'acknowledge', 'operation_id': 'cue'})
        assert result['completed']
        await output.run({'type': 'synthesize', 'operation_id': 'synth', 'text': 'Dies ist eine synthetische deutsche Testantwort.'})
        result = await output.run({'type': 'play', 'operation_id': 'play', 'text': 'Dies ist eine synthetische deutsche Testantwort.'})
        assert result == {'completed': True, 'delivered_chars': 48}, result
        await output.run({'type': 'synthesize', 'operation_id': 'synth2', 'text': 'Dies ist eine längere synthetische Antwort zum Prüfen des manuellen Abbruchs.'})
        pending = asyncio.create_task(output.run({'type': 'play', 'operation_id': 'play2', 'text': 'Dies ist eine längere synthetische Antwort zum Prüfen des manuellen Abbruchs.'}))
        await asyncio.sleep(.1)
        result = await output.run({'type': 'cancel', 'operation_id': 'cancel', 'target_operation_id': 'play2'})
        assert result == {'completed': False, 'delivered_chars': 0}
        assert (await pending)['completed'] is False
        # No delayed sound after destroying the worker; next use loads afresh.
        assert output.process is None
        await output.run({'type': 'acknowledge', 'operation_id': 'replacement', 'sound': False})
    finally:
        await output.stop()

    with tempfile.TemporaryDirectory(prefix='jv-') as directory:
        config_path = Path(directory) / 'config.json'
        config_path.write_text(json.dumps(config))
        env = {**os.environ, 'PULSE_SERVER': os.environ.get('PULSE_SERVER', f"unix:{os.environ['XDG_RUNTIME_DIR']}/pulse/native"), 'XDG_RUNTIME_DIR': directory, 'JARVIS_CONFIG': str(config_path)}
        children = []
        async def cli(*args: str) -> dict:
            child = await asyncio.create_subprocess_exec('node', 'dist/apps/core/main.js', *args, env=env, stdout=-1, stderr=-1)
            stdout, stderr = await asyncio.wait_for(child.communicate(), 60)
            assert child.returncode == 0, stderr
            return json.loads(stdout)
        try:
            for command in ((sys.executable, 'apps/audio/main.py'), ('node', 'dist/apps/core/main.js', 'start')):
                child = await asyncio.create_subprocess_exec(*command, env=env, stdout=-1, stderr=-1)
                children.append(child)
                assert child.stdout
                while True:
                    line = await asyncio.wait_for(child.stdout.readline(), 30)
                    if b'service_started' in line:
                        break
                    if not line:
                        assert child.stderr
                        raise AssertionError(await child.stderr.read())
            assert (await cli('health'))['capabilities']['tts'] == 'ready'
            assert (await cli('demo', 'Synthetische Testfrage.'))['state'] == 'follow-up'
            pending_cli = asyncio.create_task(cli('demo', 'Noch eine synthetische Testfrage.'))
            for _ in range(100):
                if (await cli('health'))['state'] == 'speaking':
                    break
                await asyncio.sleep(.05)
            else:
                raise AssertionError('playback did not start')
            assert (await cli('stop'))['state'] == 'follow-up'
            await pending_cli
            assert (await cli('mute'))['inhibitions']['muted']
            assert (await cli('unmute'))['state'] == 'idle'
        finally:
            for child in reversed(children):
                if child.returncode is None:
                    child.terminate()
                stdout, stderr = await child.communicate()
                assert b'Synthetische Testfrage' not in stdout + stderr
    print('Real adapter and core/socket synthesis, 22050→48000 resampling, drain, stop and privacy checks passed (silent null sink).')


if __name__ == '__main__':
    module = subprocess.check_output(['pactl', 'load-module', 'module-null-sink', 'sink_name=jarvis_validation', 'rate=48000'], text=True).strip()
    try:
        asyncio.run(check(sys.argv[1], 'jarvis_validation'))
    finally:
        subprocess.run(['pactl', 'unload-module', module], check=True)
