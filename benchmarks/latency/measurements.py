"""Collect content-free measurements and freeze them before service cleanup."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from typing import Any

from benchmarks.latency.resources import snapshot, summarize_resources


async def stop_collectors(tasks: list[asyncio.Task[None]]) -> bool:
    """Infinite collectors must run until we cancel them, never silently exit."""
    failed = any(task.done() for task in tasks)
    for task in tasks:
        task.cancel()
    outcomes = await asyncio.gather(*tasks, return_exceptions=True)
    return failed or any(not isinstance(outcome, asyncio.CancelledError) for outcome in outcomes)


class Measurements:
    def __init__(self, pid: int, streams: list[asyncio.StreamReader]) -> None:
        self.events: list[dict[str, Any]] = []
        self.phases: dict[str, list[dict[str, Any]]] = {'idle': [], 'active': []}
        self.phase = 'idle'
        self.stopped = False
        self.failed = False
        self.tasks = [asyncio.create_task(self._consume(stream)) for stream in streams]
        self.tasks.append(asyncio.create_task(self._sample(pid)))

    async def _consume(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            event = json.loads(line)
            if event.get('event') in {'operation_started', 'llm_first_token', 'endpoint',
                                      'recognition_final', 'tts_first_audio', 'playback_started',
                                      'playback_completed', 'interruption', 'speech_started'}:
                self.events.append({k: event[k] for k in ('event', 'operation', 'operation_id',
                                    'turn_id', 'target_operation_id', 'monotonic_ms') if k in event})
                if len(self.events) > 20000:
                    raise RuntimeError('event_budget_exceeded')

    async def _sample(self, pid: int) -> None:
        while True:
            self.phases[self.phase].append(snapshot(pid))
            await asyncio.sleep(.1)

    def check(self) -> None:
        if self.failed or self.stopped or any(task.done() for task in self.tasks):
            raise RuntimeError('measurement_collection_failed')

    def begin_active(self) -> None:
        self.check()
        self.phase = 'active'

    async def stop(self) -> None:
        if not self.stopped:
            self.failed = await stop_collectors(self.tasks)
            self.stopped = True

    def report(self) -> dict[str, Any]:
        if not self.stopped:
            raise RuntimeError('measurements_not_frozen')
        if self.failed:
            raise RuntimeError('measurement_collection_failed')
        rows = deepcopy(self.phases)
        return {'events': deepcopy(self.events), 'resource_samples': rows,
                'resources': {phase: summarize_resources(samples) for phase, samples in rows.items()}}
