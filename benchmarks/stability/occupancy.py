"""Finite isolated audio socket trials using production capture observations."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from typing import Any


from apps.audio.buffers import CAPTURE_BUFFERS


BUFFERS = CAPTURE_BUFFERS
SCENARIOS = ('idle_wake_endpoint', 'manual_replacement', 'manual_endpoint', 'maximum_duration',
             'lock', 'software_mute', 'disconnect', 'recovery')


async def collect(service: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix='jv-occupancy-') as directory:
        root = Path(directory)
        for name in ('voice.onnx', 'tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx',
                     'tiny-tokens.txt', 'silero_vad.onnx', 'hey_jarvis_v0.1.onnx',
                     'melspectrogram.onnx', 'embedding_model.onnx'):
            (root / name).write_bytes(b'fixture-model')
        (root / 'voice.onnx.json').write_text('{}')
        config = {'audio': {'mode': 'voice', 'input_device': 'fixture', 'output_device': 'fixture'},
                  'vad': {'max_utterance_seconds': 1},
                  'stt': {'model_dir': str(root)},
                  'tts': {'model_path': str(root / 'voice.onnx')},
                  'wake_word': {'model_path': str(root / 'hey_jarvis_v0.1.onnx')}}
        (root / 'config.json').write_text(json.dumps(config))
        (root / 'mode').write_text('endpoint')
        observations = root / 'buffers.json'
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(service),
            env={**os.environ, 'JARVIS_CONFIG': str(root / 'config.json'),
                 'XDG_RUNTIME_DIR': str(root), 'JARVIS_BUFFER_DIAGNOSTICS': str(observations),
                 'WAKE_FIXTURE_PID': str(root / 'capture.pid'),
                 'WAKE_FIXTURE_TRIGGER': str(root / 'trigger'), 'WAKE_FIXTURE_MODE': str(root / 'mode')},
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True)
        writers: list[asyncio.StreamWriter] = []
        async def wait_for(predicate: Any) -> None:
            for _ in range(500):
                if predicate():
                    return
                if process.returncode is not None:
                    raise RuntimeError('fixture_service_exited')
                await asyncio.sleep(.01)
            raise RuntimeError('fixture_deadline')

        async def operation(kind: str, identity: str, **values: Any) -> asyncio.StreamReader:
            reader, writer = await asyncio.open_unix_connection(str(root / 'jarvis/audio.sock'))
            writers.append(writer)
            writer.write((json.dumps({'version': 1, 'type': 'audio-operation',
                                     'operation': {'type': kind, 'operation_id': identity, **values}}) + '\n').encode())
            await writer.drain()
            return reader

        async def final(reader: asyncio.StreamReader, identity: str) -> dict[str, Any]:
            while True:
                result = json.loads(await asyncio.wait_for(reader.readline(), 5))
                if result.get('operation_id') != identity:
                    raise RuntimeError('stale_socket_event')
                if result['type'] == 'audio-result':
                    return dict(result)
                if result['type'] != 'speech-started':
                    raise RuntimeError('fixture_operation_failed')

        coverage: dict[str, str] = {}
        try:
            await wait_for(lambda: (root / 'jarvis/audio.sock').exists())
            reader = await operation('wake', SCENARIOS[0])
            await wait_for(lambda: (root / 'capture.pid').exists())
            # Require observed PCM duration > pre-roll, not a sleep/RSS inference.
            def overwritten() -> bool:
                if not observations.exists():
                    return False
                runs = json.loads(observations.read_text())['operations']
                return bool(runs and runs[-1].get('overwritten_frames', 0) >= 100)
            await wait_for(overwritten)
            (root / 'trigger').touch()
            result = await final(reader, SCENARIOS[0])
            if result.get('text') != 'Wie spät ist es?':
                raise RuntimeError('question_onset_lost')
            coverage[SCENARIOS[0]] = 'passed'
            # Manual activation cancels an owning idle wake before the cue.
            (root / 'trigger').unlink()
            (root / 'capture.pid').unlink()
            replaced = await operation('wake', 'manual_replacement')
            await wait_for(lambda: (root / 'capture.pid').exists())
            await wait_for(lambda: json.loads(observations.read_text())['operations'][-1].get('frames', 0) > 50)
            cancel = await operation('cancel', 'manual_cancel', target_operation_id='manual_replacement')
            await final(cancel, 'manual_cancel')
            old = await final(replaced, 'manual_replacement')
            if old.get('completed') is not False:
                raise RuntimeError('replacement_did_not_cancel_wake')
            coverage['manual_replacement'] = 'passed'
            (root / 'trigger').touch()
            # Manual listening begins after the acknowledgment drains.
            cue = await operation('acknowledge', 'manual_cue', sound=True)
            await final(cue, 'manual_cue')
            reader = await operation('recognize', 'manual_endpoint')
            result = await final(reader, 'manual_endpoint')
            if result.get('text') != 'Wie spät ist es?':
                raise RuntimeError('manual_question_lost')
            coverage['manual_endpoint'] = 'passed'
            (root / 'mode').write_text('maximum')
            reader = await operation('recognize', 'maximum_duration')
            await final(reader, 'maximum_duration')
            coverage['maximum_duration'] = 'passed'
            (root / 'mode').write_text('endpoint')
            (root / 'trigger').unlink()
            for scenario in ('lock', 'software_mute', 'disconnect'):
                (root / 'capture.pid').unlink(missing_ok=True)
                reader = await operation('wake', scenario)
                owner = writers[-1]
                await wait_for(lambda: (root / 'capture.pid').exists())
                await wait_for(lambda: json.loads(observations.read_text())['operations'][-1].get('frames', 0) > 50)
                pid = int((root / 'capture.pid').read_text())
                if scenario == 'disconnect':
                    owner.close()
                    await owner.wait_closed()
                else:
                    barrier = await operation('privacy', scenario + '_barrier', inhibitions={
                        'locked': scenario == 'lock', 'muted': scenario == 'software_mute',
                        'hardware_muted': False})
                    await final(barrier, scenario + '_barrier')
                def stopped() -> bool:
                    path = Path(f'/proc/{pid}/stat')
                    return not path.exists() or path.read_text().split()[2] == 'Z'
                await wait_for(stopped)
                await wait_for(lambda: json.loads(observations.read_text())['operations'][-1]['outcome'] == 'worker_terminated')
                (root / 'capture.pid').unlink()
                barrier = await operation('privacy', scenario + '_clear', inhibitions={
                    'locked': False, 'muted': False, 'hardware_muted': False})
                await final(barrier, scenario + '_clear')
                await asyncio.sleep(.05)
                if (root / 'capture.pid').exists():
                    raise RuntimeError('recovery_replayed_capture')
                coverage[scenario] = 'passed'
            (root / 'trigger').touch()
            reader = await operation('wake', 'recovery')
            result = await final(reader, 'recovery')
            if result.get('text') != 'Wie spät ist es?':
                raise RuntimeError('recovery_question_lost')
            coverage['recovery'] = 'passed'
            data = json.loads(observations.read_text())
            return evaluate(data, coverage)
        finally:
            for writer in writers:
                writer.close()
            # Kill the isolated fixture process group; never touch live services.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            await process.wait()


def buffer_verdict(counters: list[dict[str, int]], *, complete: bool) -> str:
    # Known violations remain failures even when cancellation or missing records
    # prevents a complete bound validation.
    if any(counter['high_water_samples'] > counter['limit_samples'] or
           counter['high_water_bytes'] > counter['limit_bytes'] for counter in counters):
        return 'failed'
    if complete and any(counter['high_water_samples'] > 0 for counter in counters):
        return 'passed'
    return 'unvalidated'


def evaluate(data: dict[str, Any], coverage: dict[str, str]) -> dict[str, Any]:
    operations = data['operations']
    maxima: dict[str, Any] = {}
    for name in BUFFERS:
        counters = [run['buffers'][name] for run in operations if name in run['buffers']]
        maxima[name] = {
            'verdict': buffer_verdict(counters, complete=len(counters) == len(operations)),
            'high_water_samples': max((c['high_water_samples'] for c in counters), default=0),
            'high_water_bytes': max((c['high_water_bytes'] for c in counters), default=0),
            'limit_samples': sorted({c['limit_samples'] for c in counters}),
            'limit_bytes': sorted({c['limit_bytes'] for c in counters})}
    for run in operations:
        run['buffer_verdicts'] = {
            name: buffer_verdict([run['buffers'][name]] if name in run['buffers'] else [],
                                 complete=run['outcome'] == 'released')
            for name in BUFFERS}
    identities = [run['operation_id'] for run in operations]
    complete = (identities == list(SCENARIOS) and all(coverage.get(s) == 'passed' for s in SCENARIOS) and
                all(run.get('frames', 0) > 0 for run in operations))
    released = all(run['outcome'] == ('worker_terminated' if run['operation_id'] in
                   {'manual_replacement', 'lock', 'software_mute', 'disconnect'} else 'released') for run in operations)
    released = released and all(all(c['current_samples'] == 0 for c in run['buffers'].values())
                                for run in operations if run['outcome'] == 'released')
    # A new generation must separate each canceled capture from its successor.
    generations = {run['operation_id']: run['generation'] for run in operations}
    fresh = (complete and generations['manual_replacement'] < generations['manual_endpoint'] and
             generations['lock'] < generations['software_mute'] < generations['disconnect'] < generations['recovery'])
    endpointed = all(run.get('capture_end') == ('maximum_duration' if run['operation_id'] == 'maximum_duration' else 'endpoint')
                     for run in operations if run['outcome'] == 'released')
    passed = complete and released and fresh and endpointed and all(b['verdict'] == 'passed' for b in maxima.values())
    return {'verdict': 'passed' if passed else 'failed', 'coverage': coverage,
            'buffers': maxima, 'operations': operations,
            'lifecycle': 'passed' if released and fresh else 'failed',
            'rejected_observations': data['rejected_observations'],
            'units': {'samples': 'scalar PCM samples', 'bytes': 'sample payload bytes; excludes array metadata/backing copies'},
            'configuration': {'sample_rate_hz': 16000, 'channels': 1, 'pre_roll_ms': 750,
                              'max_utterance_seconds': 1, 'wake_threshold': 0.2},
            'unvalidated': ['openWakeWord inference buffers', 'native resampler/VAD/model allocations',
                            'Piper synthesis', 'OS/PipeWire queues', 'array backing storage and transient conversion copies',
                            'heap erasure', 'physical devices', 'other unmeasured queues']}
