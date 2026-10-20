"""Endpointed CPU recognition. Only active listening opens a capture stream."""
from __future__ import annotations

from collections import deque
import hashlib
import importlib
import json
import os
from pathlib import Path
import select
import re
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

        self.wake_detector: Any = None
        self.wake_diagnostic: str | None = 'wake_disabled'
        if config['wake_word']['enabled']:
            try:
                wake_module = importlib.import_module('apps.audio.wake' if __package__ else 'wake')
                self.wake_detector = wake_module.WakeDetector(config)
                self.wake_diagnostic = None
            except Exception as error:
                self.wake_detector = None
                allowed = {'unsupported_wake_runtime', 'unsupported_wake_model', 'missing_wake_model',
                           'wake_checksum_mismatch', 'wake_cpu_required', 'input_device_missing',
                           'input_device_muted'}
                self.wake_diagnostic = str(error) if str(error) in allowed else 'wake_runtime_unavailable'

    def recognize(self, emit: Any, cancelled: Any = None, echo_reference: Any = None, *, wake: bool = False) -> dict[str, Any]:
        diagnostic = None
        if os.environ.get('JARVIS_BUFFER_DIAGNOSTICS'):
            module = importlib.import_module('apps.audio.buffers' if __package__ else 'buffers')
            diagnostic = module.CaptureOccupancy(emit)
        result = self._recognize(emit, cancelled, echo_reference, wake=wake, diagnostic=diagnostic)
        # The capture function has returned: its arrays and views are released.
        if diagnostic:
            diagnostic.released()
        return result

    def _recognize(self, emit: Any, cancelled: Any, echo_reference: Any, *, wake: bool, diagnostic: Any) -> dict[str, Any]:
        if wake and self.wake_detector is None:
            raise RuntimeError('wake_runtime_unavailable')
        if wake:
            self.wake_detector.reset()
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
        # Wake idle continuously overwrites this bounded ring. Manual pre-roll
        # begins after the cue; neither mode sends ambient audio to STT.
        ring: deque[Any] = deque(maxlen=((128 if echo_reference is not None else self.config['audio']['pre_roll_ms']) * 16) // 512)
        if diagnostic:
            diagnostic.configure(rate, channels, ring.maxlen, 2 if echo_reference is not None else self.config['vad']['max_utterance_seconds'])
        utterance: list[Any] = []
        pending = self.np.zeros(0, dtype=self.np.float32)
        wake_pending = self.np.zeros(0, dtype=self.np.float32)
        activated = not wake
        speaking = False
        started = time.monotonic()
        cap = (24 * 3600 - 60) if wake else 2 if echo_reference is not None else self.config['vad']['max_utterance_seconds']
        boundary = None
        if echo_reference is not None:
            stop_control = importlib.import_module('apps.audio.stop_control' if __package__ else 'stop_control')
            # Require a silence boundary in every window, including after a
            # truncated utterance. A continued phrase's tail cannot be a command.
            boundary = stop_control.ControlBoundary(max(11, (self.config['vad']['end_silence_ms'] * 16) // 512))
        last_check = started
        last_audio = started
        frame_bytes = rate // 50 * channels * 2
        raw = bytearray()
        try:
            assert capture.stdout
            active = False
            while time.monotonic() - started < cap and not (cancelled and cancelled.is_set()):
                if time.monotonic() - last_check >= .25:
                    selected_source(self.config)
                    last_check = time.monotonic()
                if not select.select([capture.stdout], [], [], .1)[0]:
                    if time.monotonic() - last_audio > 2:
                        raise RuntimeError('input_disconnected')
                    continue
                block = os.read(capture.stdout.fileno(), frame_bytes)
                if not block:
                    raise RuntimeError('input_disconnected')
                last_audio = time.monotonic()
                raw.extend(block)
                if diagnostic:
                    diagnostic.observe('raw_pcm', (len(raw) + 1) // 2, len(raw))
                size = len(raw) // (channels * 2) * (channels * 2)
                if not size:
                    continue
                mono = self.np.frombuffer(bytes(raw[:size]), dtype='<i2').reshape(-1, channels).mean(axis=1).astype('float32') / 32768
                del raw[:size]
                if diagnostic:
                    diagnostic.observe('raw_pcm', (len(raw) + 1) // 2, len(raw))
                pending = self.np.concatenate((pending, resampler.resample_chunk(mono)))
                if diagnostic:
                    diagnostic.observe('resampled_pending', len(pending))
                while len(pending) >= 512:
                    frame, pending = pending[:512], pending[512:]
                    if diagnostic:
                        diagnostic.frames += 1
                        diagnostic.observe('resampled_pending', len(pending))
                    if not activated:
                        if diagnostic and len(ring) == ring.maxlen:
                            diagnostic.overwritten_frames += 1
                        ring.append(frame.copy())
                        if diagnostic:
                            diagnostic.observe('pre_roll', len(ring) * 512)
                        wake_pending = self.np.concatenate((wake_pending, frame))
                        if diagnostic:
                            diagnostic.observe('wake_pending', len(wake_pending))
                        if len(wake_pending) < 1280:
                            continue
                        wake_frame, wake_pending = wake_pending[:1280], wake_pending[1280:]
                        if diagnostic:
                            diagnostic.observe('wake_pending', len(wake_pending))
                        if not self.wake_detector.detected(self.np.clip(wake_frame * 32768, -32768, 32767).astype('<i2')):
                            continue
                        activated = True
                        active = True
                        utterance.extend(ring)
                        for buffered in ring:
                            self.vad.accept_waveform(buffered)
                        speaking = self.vad.is_speech_detected()
                        ring.clear()
                        if diagnostic:
                            diagnostic.observe('pre_roll', 0)
                            diagnostic.observe('utterance', len(utterance) * 512)
                        started = time.monotonic()
                        cap = self.config['vad']['max_utterance_seconds']
                        emit('wake_detected')
                        emit('speech_started')
                        # Same capture, resampler and pending frames: no cue or reopen.
                        continue
                    self.vad.accept_waveform(frame)
                    active = self.vad.is_speech_detected()
                    if wake:
                        utterance.append(frame.copy())
                        speaking = speaking or active
                    elif speaking:
                        utterance.append(frame.copy())
                    else:
                        if diagnostic and len(ring) == ring.maxlen:
                            diagnostic.overwritten_frames += 1
                        ring.append(frame.copy())
                        if diagnostic:
                            diagnostic.observe('pre_roll', len(ring) * 512)
                        if (boundary.accept(active) if boundary is not None else active):
                            speaking = True
                            emit('speech_started')
                            utterance.extend(ring)
                            ring.clear()
                            if diagnostic:
                                diagnostic.observe('pre_roll', 0)
                                diagnostic.observe('utterance', len(utterance) * 512)
                    if diagnostic:
                        diagnostic.observe('utterance', len(utterance) * 512)
                    while not self.vad.empty():
                        self.vad.pop()
                    if speaking and not active:
                        break
                if diagnostic:
                    diagnostic.checkpoint()
                if speaking and not active:
                    break
        finally:
            capture.kill()
            capture.wait()
            if capture.stdout:
                capture.stdout.close()
            self.vad.reset()
            ring.clear()
            if wake:
                self.wake_detector.reset()
        endpoint = time.monotonic()
        emit('endpoint', elapsed_ms=round((endpoint - started) * 1000))
        endpoint_complete = speaking and not active
        echo = False
        samples = self.np.concatenate(utterance) if utterance else self.np.zeros(0, dtype=self.np.float32)
        if diagnostic:
            diagnostic.capture_end = 'endpoint' if endpoint_complete else 'maximum_duration'
            diagnostic.observe('handoff', len(samples))
            diagnostic.checkpoint('decoding')
        if echo_reference is not None:
            stop_control = importlib.import_module('apps.audio.stop_control' if __package__ else 'stop_control')
            echo = stop_control.is_echo(samples, echo_reference, self.np)
        text = (self.recognizer.recognize(samples)
                if speaking and (echo_reference is None or endpoint_complete) and not echo and not (cancelled and cancelled.is_set()) else '')
        if wake:
            text = re.sub(r'^(?:(?:hey|he|hallo)\s+)?ja(?:r)?vis[\s,.:!?-]*', '', text, flags=re.IGNORECASE).strip()
        utterance.clear()
        emit('recognition_final', elapsed_ms=round((time.monotonic() - endpoint) * 1000))
        if echo_reference is not None:
            return {'text': text, 'endpoint': endpoint_complete, 'echo': echo}
        return {'text': text}
