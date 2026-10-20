"""Opt-in, content-free logical capture occupancy (never owns audio).

The worker aggregates every mutation; checkpoints travel over its existing bounded
pipe. The parent retains only the latest 32 operation summaries, atomically.
"""
from __future__ import annotations

from collections import deque
import json
import os
from pathlib import Path
from typing import Any


CAPTURE_BUFFERS = ('raw_pcm', 'resampled_pending', 'wake_pending', 'pre_roll', 'utterance', 'handoff')
COUNTER_FIELDS = ('current_samples', 'current_bytes', 'high_water_samples', 'high_water_bytes',
                  'limit_samples', 'limit_bytes', 'sample_bytes')


class CaptureOccupancy:
    def __init__(self, emit: Any) -> None:
        self.emit = emit
        self.buffers: dict[str, dict[str, int]] = {}
        self.overwritten_frames = 0
        self.frames = 0
        self.capture_end = 'unvalidated'

    def configure(self, rate: int, channels: int, pre_roll_frames: int, seconds: float) -> None:
        # Nominal wall-clock audio budget, including pre-roll and a final frame.
        # A faster-than-realtime producer can violate it; observation must fail,
        # never silently increase this budget.
        for name, limit, width in (
            ('raw_pcm', (rate // 50 + 1) * channels, 2),
            ('resampled_pending', 511 + 320 + 512, 4),
            ('wake_pending', 1279 + 512, 4),
            ('pre_roll', pre_roll_frames * 512, 4),
            ('utterance', int(seconds * 16000) + pre_roll_frames * 512 + 512, 4),
            ('handoff', int(seconds * 16000) + pre_roll_frames * 512 + 512, 4),
        ):
            self.buffers[name] = dict(current_samples=0, current_bytes=0,
                                      high_water_samples=0, high_water_bytes=0,
                                      limit_samples=limit, limit_bytes=limit * width,
                                      sample_bytes=width)

    def observe(self, name: str, samples: int, byte_count: int | None = None) -> None:
        counter = self.buffers[name]
        counter['current_samples'] = samples
        counter['current_bytes'] = samples * counter['sample_bytes'] if byte_count is None else byte_count
        counter['high_water_samples'] = max(counter['high_water_samples'], samples)
        counter['high_water_bytes'] = max(counter['high_water_bytes'], counter['current_bytes'])

    def checkpoint(self, outcome: str = 'capturing') -> None:
        self.emit('buffer_occupancy', buffers=self.buffers, outcome=outcome,
                  overwritten_frames=self.overwritten_frames, frames=self.frames, capture_end=self.capture_end)

    def released(self) -> None:
        for name in self.buffers:
            self.observe(name, 0)
        self.checkpoint('released')


class BufferEvidence:
    def __init__(self) -> None:
        target = os.environ.get('JARVIS_BUFFER_DIAGNOSTICS')
        self.path = Path(target) if target else None
        self.operations: deque[dict[str, Any]] = deque(maxlen=32)
        self.active: dict[str, Any] | None = None
        self.rejected = 0
        self.sequence = 0
        if self.path:
            self.write()

    def write(self) -> None:
        if self.path:
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps({'operations': list(self.operations),
                                             'rejected_observations': self.rejected}) + '\n')
            temporary.replace(self.path)

    def begin(self, operation: dict[str, Any], generation: int) -> None:
        if self.path:
            self.sequence += 1
            self.active = {'operation_id': operation['operation_id'], 'generation': generation,
                           'capture_sequence': self.sequence, 'outcome': 'unobserved', 'buffers': {}}
            self.operations.append(self.active)
            self.write()

    def accept(self, event: dict[str, Any], operation: dict[str, Any], generation: int) -> None:
        if not self.path:
            return
        if (self.active is None or event.get('operation_id') != operation['operation_id'] or
                event.get('generation') != generation or
                self.active['generation'] != generation or
                self.active['operation_id'] != operation['operation_id'] or
                event.get('capture_sequence') != self.active['capture_sequence']):
            self.rejected += 1
        else:
            # Explicit allowlist: never persist arbitrary worker fields.
            self.active['buffers'] = {
                name: {key: value for key, value in counters.items()
                       if key in COUNTER_FIELDS and type(value) is int and value >= 0}
                for name, counters in event.get('buffers', {}).items()
                if name in CAPTURE_BUFFERS and isinstance(counters, dict)}
            for key in ('overwritten_frames', 'frames'):
                value = event.get(key)
                if type(value) is int and value >= 0:
                    self.active[key] = value
            self.active['outcome'] = (event['outcome'] if event.get('outcome') in
                                      {'capturing', 'decoding', 'released'} else 'unvalidated')
            self.active['capture_end'] = (event['capture_end'] if event.get('capture_end') in
                                          {'endpoint', 'maximum_duration'} else 'unvalidated')
        self.write()

    def terminated(self, generation: int) -> None:
        if self.active and self.active['generation'] == generation:
            if self.active['outcome'] != 'released':
                self.active['outcome'] = 'worker_terminated'
            self.active = None
            self.write()
