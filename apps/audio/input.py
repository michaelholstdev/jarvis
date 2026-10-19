"""Endpointed CPU recognition. Only active listening opens a capture stream."""
from __future__ import annotations

from collections import deque
import hashlib
import importlib
import json
import os
from pathlib import Path
import select
import subprocess
import time
from typing import Any, Protocol


class StreamingRecognizer(Protocol):
    """Replaceable recognition boundary; this backend returns only a final result."""

    def recognize(self, samples: Any) -> str: ...


def verify_input(config: dict[str, Any]) -> None:
    manifest = json.loads((Path(__file__).resolve().parents[2] / 'config/models.json').read_text())
    selection = config['stt']['model']
    if selection == 'whisper-tiny-int8':
        names = ['tiny-encoder.int8.onnx', 'tiny-decoder.int8.onnx', 'tiny-tokens.txt']
    elif selection == 'parakeet-tdt-v3-int8':
        names = ['parakeet-' + name for name in
                 ('encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt')]
    else:
        raise RuntimeError('unsupported_input_model')
    models = {model['id']: model for model in manifest['models']}
    for name in [*names, 'silero_vad.onnx']:
        model = models[name]
        path = Path(config['stt']['model_dir']) / Path(model['local_path']).name
        if not path.is_file():
            raise RuntimeError('missing_input_model')
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != model['sha256']:
            raise RuntimeError('input_checksum_mismatch')


def selected_source(config: dict[str, Any]) -> dict[str, Any]:
    sources = json.loads(subprocess.check_output(
        ['pactl', '--format=json', 'list', 'sources'], timeout=2))
    name = config['audio']['input_device']
    source = next((s for s in sources if s['name'] == name and name != 'default'), None)
    if source is None:
        raise RuntimeError('input_device_missing')
    if source['mute']:
        raise RuntimeError('input_device_muted')
    return dict(source)


class EndpointedRecognizer:
    """Shared final decoding for resident sherpa offline engines."""

    engine: Any

    def recognize(self, samples: Any) -> str:
        stream = self.engine.create_stream()
        stream.accept_waveform(16000, samples)
        self.engine.decode_stream(stream)
        return str(stream.result.text).strip()


class WhisperRecognizer(EndpointedRecognizer):
    def __init__(self, config: dict[str, Any], sherpa: Any) -> None:
        directory = Path(config['stt']['model_dir'])
        self.engine = sherpa.OfflineRecognizer.from_whisper(
            encoder=str(directory / 'tiny-encoder.int8.onnx'),
            decoder=str(directory / 'tiny-decoder.int8.onnx'),
            tokens=str(directory / 'tiny-tokens.txt'), language='de', task='transcribe',
            num_threads=2, provider='cpu', debug=False)


class ParakeetRecognizer(EndpointedRecognizer):
    """Pinned NeMo TDT v3 INT8 export; endpointed CPU inference, no partials."""

    def __init__(self, config: dict[str, Any], sherpa: Any) -> None:
        directory = Path(config['stt']['model_dir'])
        self.engine = sherpa.OfflineRecognizer.from_transducer(
            encoder=str(directory / 'encoder.int8.onnx'),
            decoder=str(directory / 'decoder.int8.onnx'),
            joiner=str(directory / 'joiner.int8.onnx'), tokens=str(directory / 'tokens.txt'),
            model_type='nemo_transducer', num_threads=2, provider='cpu',
            decoding_method='greedy_search', debug=False)


class Input:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.np = importlib.import_module('numpy')
        self.soxr = importlib.import_module('soxr')
        sherpa = importlib.import_module('sherpa_onnx')
        from importlib.metadata import version
        if version('sherpa-onnx') != '1.13.8' or version('sherpa-onnx-core') != '1.13.8':
            raise RuntimeError('unsupported_input_runtime')
        verify_input(config)
        vad_config = sherpa.VadModelConfig()
        vad_config.silero_vad.model = str(Path(config['stt']['model_dir']) / 'silero_vad.onnx')
        vad_config.silero_vad.threshold = .5
        vad_config.silero_vad.min_speech_duration = .128
        vad_config.silero_vad.min_silence_duration = config['vad']['end_silence_ms'] / 1000
        vad_config.silero_vad.max_speech_duration = config['vad']['max_utterance_seconds']
        vad_config.sample_rate = 16000
        vad_config.num_threads = 1
        vad_config.provider = 'cpu'
        self.vad = sherpa.VoiceActivityDetector(vad_config, buffer_size_in_seconds=1)
        self.recognizer: StreamingRecognizer = (
            ParakeetRecognizer(config, sherpa) if config['stt']['model'] == 'parakeet-tdt-v3-int8'
            else WhisperRecognizer(config, sherpa))

    def recognize(self, emit: Any, cancelled: Any = None, echo_reference: Any = None) -> dict[str, Any]:
        source = selected_source(self.config)
        if echo_reference is not None and (source['name'].endswith('.monitor') or source.get('monitor_of_sink_name')):
            raise RuntimeError('input_device_missing')
        spec = source['sample_specification'].split()
        channels, rate = int(spec[-2].removesuffix('ch')), int(spec[-1].removesuffix('Hz'))
        if not 1 <= channels <= 8 or not 8000 <= rate <= 192000:
            raise RuntimeError('input_format_unsupported')
        target = source['properties']['node.name']
        capture = subprocess.Popen([
            'pw-record', '--target', target, '--rate', str(rate), '--channels', str(channels),
            '--format', 's16', '--raw', '--latency', '32ms',
            '--properties', '{ node.dont-fallback=true node.dont-reconnect=true node.dont-move=true ' +
            ('stream.capture.sink=true ' if source['name'].endswith('.monitor') else '') + '}',
            '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.vad.reset()
        resampler = self.soxr.ResampleStream(rate, 16000, 1, dtype='float32')
        # Manual-only pre-roll starts after the cue: preserve audio preceding VAD onset,
        # without opening an idle microphone or retaining acknowledgment audio.
        ring: deque[Any] = deque(maxlen=((128 if echo_reference is not None else self.config['audio']['pre_roll_ms']) * 16 + 511) // 512)
        utterance: list[Any] = []
        pending = self.np.zeros(0, dtype=self.np.float32)
        speaking = False
        started = time.monotonic()
        cap = 2 if echo_reference is not None else self.config['vad']['max_utterance_seconds']
        boundary = None
        if echo_reference is not None:
            stop_control = importlib.import_module('apps.audio.stop_control' if __package__ else 'stop_control')
            # Require a silence boundary in every window, including after a
            # truncated utterance. A continued phrase's tail cannot be a command.
            boundary = stop_control.ControlBoundary(max(11, (self.config['vad']['end_silence_ms'] * 16 + 511) // 512))
        last_check = started
        frame_bytes = rate // 50 * channels * 2
        raw = bytearray()
        try:
            assert capture.stdout
            while time.monotonic() - started < cap and not (cancelled and cancelled.is_set()):
                if time.monotonic() - last_check >= .25:
                    selected_source(self.config)
                    last_check = time.monotonic()
                if not select.select([capture.stdout], [], [], .1)[0]:
                    continue
                block = os.read(capture.stdout.fileno(), frame_bytes)
                if not block:
                    raise RuntimeError('input_disconnected')
                raw.extend(block)
                size = len(raw) // (channels * 2) * (channels * 2)
                if not size:
                    continue
                mono = self.np.frombuffer(bytes(raw[:size]), dtype='<i2').reshape(-1, channels).mean(axis=1).astype('float32') / 32768
                del raw[:size]
                pending = self.np.concatenate((pending, resampler.resample_chunk(mono)))
                while len(pending) >= 512:
                    frame, pending = pending[:512], pending[512:]
                    self.vad.accept_waveform(frame)
                    active = self.vad.is_speech_detected()
                    if speaking:
                        utterance.append(frame.copy())
                    else:
                        ring.append(frame.copy())
                        if (boundary.accept(active) if boundary is not None else active):
                            speaking = True
                            emit('speech_started')
                            utterance.extend(ring)
                            ring.clear()
                    while not self.vad.empty():
                        self.vad.pop()
                    if speaking and not active:
                        break
                if speaking and not active:
                    break
        finally:
            capture.kill()
            capture.wait()
            if capture.stdout:
                capture.stdout.close()
            self.vad.reset()
            ring.clear()
        endpoint = time.monotonic()
        emit('endpoint', elapsed_ms=round((endpoint - started) * 1000))
        endpoint_complete = speaking and not active
        echo = False
        samples = self.np.concatenate(utterance) if utterance else self.np.zeros(0, dtype=self.np.float32)
        if echo_reference is not None:
            stop_control = importlib.import_module('apps.audio.stop_control' if __package__ else 'stop_control')
            echo = stop_control.is_echo(samples, echo_reference, self.np)
        text = (self.recognizer.recognize(samples)
                if speaking and (echo_reference is None or endpoint_complete) and not echo and not (cancelled and cancelled.is_set()) else '')
        utterance.clear()
        emit('recognition_final', elapsed_ms=round((time.monotonic() - endpoint) * 1000))
        if echo_reference is not None:
            return {'text': text, 'endpoint': endpoint_complete, 'echo': echo}
        return {'text': text}
