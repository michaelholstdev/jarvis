"""Conservative playback-only control validation; never forwards transcripts."""
from __future__ import annotations

import re
from typing import Any


def accepts_stop(text: str, reply: str, *, endpoint: bool, echo: bool) -> bool:
    # A reference containing the command is ambiguous even when echo correlation fails.
    return (endpoint and not echo and
            re.search(r'\bstopp\b', reply, re.IGNORECASE) is None and
            text.strip().lower().rstrip('.!?;:') == 'stopp')


def is_echo(samples: Any, reference: Any, np: Any) -> bool:
    """Normalized FFT correlation against the actual output, allowing acoustic delay.

    Conservative provisional threshold; not an acoustic acceptance claim.
    Downsampling bounds CPU and memory for the <=60 s synthesized reference.
    """
    signal = samples[::4].astype('float64')
    playback = reference[::4].astype('float64')
    if len(signal) < 128 or len(playback) < len(signal):
        return False
    signal -= signal.mean()
    power = float(np.dot(signal, signal))
    if power < 1e-8:
        return True
    playback -= playback.mean()
    size = 1 << (len(playback) + len(signal) - 1).bit_length()
    correlation = np.fft.irfft(np.fft.rfft(playback, size) *
                              np.fft.rfft(signal[::-1], size), size)
    correlation = correlation[len(signal) - 1:len(playback)]
    energy = np.concatenate(([0.], np.cumsum(playback * playback)))
    energy = energy[len(signal):] - energy[:-len(signal)]
    score = np.abs(correlation) / np.sqrt(np.maximum(energy * power, 1e-12))
    return bool(np.max(score) >= .35)


class ControlBoundary:
    """A new capture window must observe silence before accepting any speech."""

    def __init__(self, silence_frames: int) -> None:
        self.required = silence_frames
        self.silence = 0
        self.armed = False

    def accept(self, active: bool) -> bool:
        if not self.armed:
            self.silence = 0 if active else self.silence + 1
            self.armed = self.silence >= self.required
        return self.armed and active


class StopMonitor:
    """Playback-scoped capture on the resident microphone/recognizer boundary."""

    def __init__(self, config: dict[str, Any], microphone: Any, reference: Any, reply: str, emit: Any) -> None:
        import threading
        import time
        self.cancelled = threading.Event()
        self.reader: Any = None
        if (microphone is None or config['audio']['mode'] != 'voice' or
                not config['features']['voice_stop'] or
                re.search(r'\bstopp\b', reply, re.IGNORECASE)):
            return

        def read() -> None:
            deadline = time.monotonic() + 60
            try:
                while not self.cancelled.is_set() and time.monotonic() < deadline:
                    result = microphone.recognize(lambda *args, **kwargs: None, self.cancelled, reference)
                    if not self.cancelled.is_set() and accepts_stop(
                            result['text'], reply, endpoint=result['endpoint'], echo=result['echo']):
                        emit('control_stopped')
                        return
            except Exception:
                # Local recognition failure leaves playback/manual controls usable.
                emit('voice_stop_unavailable')

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()

    def close(self) -> None:
        self.cancelled.set()
        if self.reader:
            # Capture polls cancellation. A stalled native decode is bounded by
            # the owning Output operation's fixed watchdog/process-group kill.
            self.reader.join()
