"""Private worker protocol. PCM stays here; PulseAudio's drain confirms completion."""
from __future__ import annotations

import ctypes as C
import importlib
import json
import math
import re
import sys
import threading
import time
from typing import Any


EMIT_LOCK = threading.Lock()


def emit(event: str, **values: Any) -> None:
    with EMIT_LOCK:
        print(json.dumps({'event': event, **values, 'monotonic_ms': time.monotonic_ns() / 1e6}, separators=(',', ':')), flush=True)


class SampleSpec(C.Structure):
    _fields_ = [('format', C.c_int), ('rate', C.c_uint32), ('channels', C.c_uint8)]


class Pulse:
    def __init__(self, device: str, rate: int) -> None:
        self.lib = C.CDLL('libpulse-simple.so.0')
        self.lib.pa_simple_new.restype = C.c_void_p
        self.lib.pa_simple_new.argtypes = [C.c_char_p, C.c_char_p, C.c_int, C.c_char_p, C.c_char_p, C.POINTER(SampleSpec), C.c_void_p, C.c_void_p, C.POINTER(C.c_int)]
        self.lib.pa_simple_write.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_int)]
        self.lib.pa_simple_drain.argtypes = [C.c_void_p, C.POINTER(C.c_int)]
        self.lib.pa_simple_free.argtypes = [C.c_void_p]
        error = C.c_int()
        self.stream = self.lib.pa_simple_new(None, b'Jarvis', 1, device.encode(), b'answer', C.byref(SampleSpec(3, rate, 1)), None, None, C.byref(error))
        if not self.stream:
            raise RuntimeError('output_unavailable')

    def play(self, pcm: bytes, rate: int) -> None:
        error = C.c_int()
        try:
            # 20 ms writes; completion requires server drain, never synthesis EOF.
            size = rate // 50 * 2
            for offset in range(0, len(pcm), size):
                block = pcm[offset:offset + size]
                if self.lib.pa_simple_write(self.stream, block, len(block), C.byref(error)) < 0:
                    raise RuntimeError('write_failed')
                if offset == 0:
                    emit('playback_started')
            if self.lib.pa_simple_drain(self.stream, C.byref(error)) < 0:
                raise RuntimeError('drain_failed')
            emit('playback_completed')
        finally:
            self.lib.pa_simple_free(self.stream)


def main() -> None:
    config = json.loads(sys.stdin.readline())
    np = importlib.import_module('numpy')
    soxr = importlib.import_module('soxr')
    voice_loader = importlib.import_module('apps.audio.voice' if __package__ else 'voice')
    voice = voice_loader.load_cpu_voice(config['tts']['model_path'])
    # Discover by stable sink name, never a transient numeric index or default.
    import subprocess
    sinks = json.loads(subprocess.check_output(['pactl', '--format=json', 'list', 'sinks'], timeout=5))
    sink = next((s for s in sinks if s['name'] == config['audio']['output_device'] and s['name'] != 'default'), None)
    if sink is None:
        raise RuntimeError('output_device_missing')
    if sink['mute']:
        raise RuntimeError('output_device_muted')
    rate = int(sink['sample_specification'].split()[-1].removesuffix('Hz'))
    if not 8000 <= rate <= 192000:
        raise RuntimeError('unsupported_rate')
    C.CDLL('libpulse-simple.so.0')
    microphone = None
    if config['audio']['mode'] == 'voice':
        microphone = importlib.import_module('apps.audio.input' if __package__ else 'input').Input(config)

    def synthesize(text: str) -> tuple[str, list[tuple[bytes, int]]]:
        if len(text.encode('utf-8')) > 4096:
            raise RuntimeError('text_too_large')
        notice = 'Die Antwort ist zu lang zum Vorlesen. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.'
        limit = voice.config.sample_rate * 60
        text_budget = min(4096, config['llm']['max_context_tokens'])
        first_audio = True

        def render(sentence: str, budget: int) -> tuple[bytes, int] | None:
            nonlocal first_audio
            chunks = []
            samples = 0
            for chunk in voice.synthesize(sentence):
                if first_audio and len(chunk.audio_float_array):
                    emit('tts_first_audio')
                    first_audio = False
                samples += len(chunk.audio_float_array)
                if samples > budget:
                    return None
                chunks.append(chunk.audio_float_array)
            audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
            if voice.config.sample_rate != rate:
                audio = soxr.resample(audio, voice.config.sample_rate, rate)
            block = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
            return block, samples

        # Reserve measured audio for an explicit notice instead of discarding
        # the entire answer when a later sentence crosses the duration bound.
        rendered_notice = render(notice, limit)
        if rendered_notice is None:
            raise RuntimeError('audio_too_large')
        notice_pcm, notice_samples = rendered_notice
        remaining = limit - notice_samples
        segments = []
        delivered_text = ''
        for sentence in re.findall(r'.+?(?:[.!?](?:\s+|$)|$)', text, re.DOTALL):
            candidate = delivered_text + sentence
            rendered = (
                render(sentence, remaining)
                if len((candidate + notice).encode('utf-8')) <= text_budget else None
            )
            if rendered is None:
                delivered_text += notice
                segments.append((notice_pcm, len(delivered_text.encode('utf-16-le')) // 2))
                return delivered_text, segments
            block, samples = rendered
            remaining -= samples
            delivered_text += sentence
            segments.append((block, len(delivered_text.encode('utf-16-le')) // 2))
        return delivered_text, segments

    def play(text: str, segments: list[tuple[bytes, int]]) -> None:
        pcm = b''.join(block for block, _ in segments)
        if not pcm:
            raise RuntimeError('missing_synthesis')
        control = importlib.import_module('apps.audio.stop_control' if __package__ else 'stop_control')
        reference = np.frombuffer(pcm, dtype='<i2').astype('float32') / 32768
        if rate != 16000:
            reference = soxr.resample(reference, rate, 16000)
        monitor = control.StopMonitor(config, microphone, reference, text, emit)
        try:
            for block, delivered_chars in segments:
                Pulse(sink['name'], rate).play(block, rate)
                emit('playback_delivered', delivered_chars=delivered_chars)
        finally:
            monitor.close()

    cached_text = ''
    segments: list[tuple[bytes, int]] = []
    emit('ready', wake_ready=bool(microphone and microphone.wake_detector),
         wake_diagnostic=microphone.wake_diagnostic if microphone else 'wake_disabled')
    for line in sys.stdin:
        operation = json.loads(line)
        kind = operation['type']
        if kind not in {'recognize', 'wake'}:
            current = json.loads(subprocess.check_output(['pactl', '--format=json', 'list', 'sinks'], timeout=2))
            selected = next((s for s in current if s['name'] == sink['name']), None)
            if selected is None:
                raise RuntimeError('output_device_missing')
            if selected['mute']:
                raise RuntimeError('output_device_muted')
        if kind in {'recognize', 'wake'}:
            if microphone is None or 'text' in operation:
                raise RuntimeError('invalid_recognition')
            def capture_emit(event: str, **values: Any) -> None:
                if event == 'buffer_occupancy':
                    values.update(operation_id=operation['operation_id'],
                                  generation=operation.get('diagnostic_generation'),
                                  capture_sequence=operation.get('diagnostic_sequence'))
                emit(event, **values)
            emit('result', result=microphone.recognize(capture_emit, wake=kind == 'wake'))
        elif kind == 'synthesize':
            cached_text = ''
            segments.clear()
            cached_text, segments = synthesize(operation['text'])
            emit('result', result={'text': cached_text} if cached_text != operation['text'] else {})
        elif kind == 'play':
            if not segments or operation.get('text') != cached_text:
                raise RuntimeError('missing_synthesis')
            play(cached_text, segments)
            delivered = len(cached_text.encode('utf-16-le')) // 2
            cached_text = ''
            segments.clear()
            emit('result', result={'completed': True, 'delivered_chars': delivered})
        else:
            cached_text = ''
            segments.clear()
            if operation.get('sound', True):
                frequency = {'acknowledge': 880, 'close-conversation': 440, 'indicate-failure': 220}[kind]
                t = np.arange(int(rate * .12)) / rate
                tone = (.12 * np.sin(2 * math.pi * frequency * t) * np.sin(math.pi * t / .12)).astype(np.float32)
                Pulse(sink['name'], rate).play((tone * 32767).astype('<i2').tobytes(), rate)
            emit('result', result={'completed': True, 'delivered_chars': 0})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        safe_diagnostic = importlib.import_module(
            'apps.audio.audio_errors' if __package__ else 'audio_errors'
        ).safe_diagnostic
        emit('error', diagnostic=safe_diagnostic(str(error)))
        raise SystemExit(1) from None
