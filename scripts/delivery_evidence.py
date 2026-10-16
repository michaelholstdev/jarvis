"""Compare independent source PCM with sink capture frozen at a delivery event."""
from __future__ import annotations

CAPTURE_LAG_MS = 20


def verify_prefix(captured: bytes, sentences: list[bytes], rate: int) -> None:
    """Require each source waveform in order, allowing at most 20 ms capture lag.

    References are synthesized independently of adapter delivery reports. Full
    waveforms, rather than amplitude totals, establish the sentence boundaries.
    Stream startup/gaps and constant output gain are allowed; missing speech isn't.
    """
    import numpy as np

    signal = np.frombuffer(captured, dtype='<i2').astype('float64')
    cursor = 0
    for sentence in sentences:
        reference = np.frombuffer(sentence, dtype='<i2').astype('float64')
        lag = rate * CAPTURE_LAG_MS // 1000
        reference = reference[:len(reference) - lag] if lag else reference
        remaining = signal[cursor:]
        assert len(reference) > 0 and len(remaining) >= len(reference), 'unobserved sentence PCM'
        size = 1 << (len(remaining) + len(reference) - 2).bit_length()
        convolution = np.fft.irfft(
            np.fft.rfft(remaining, size) * np.fft.rfft(reference[::-1], size), size,
        )
        offset = int(np.argmax(convolution[len(reference) - 1:len(remaining)]))
        observed = remaining[offset:offset + len(reference)]
        denominator = float(np.linalg.norm(observed) * np.linalg.norm(reference))
        correlation = float(np.dot(observed, reference)) / denominator if denominator else 0
        assert correlation >= .9999, 'unobserved sentence PCM'
        cursor += offset + len(reference)
