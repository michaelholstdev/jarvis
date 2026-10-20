# Production capture buffer evidence — #18, 2026-10-20

This delivers the scoped instrumentation follow-up to #18. It does not close
physical, network/privacy or release acceptance. Task-start/review baseline:
`d2e56dd4c01a8e39e31c87025f0cbe00b22fa777`. Existing 44.02-minute evidence stays
partial; the user waiver of the two-hour idle duration remains in effect.

Reproduce from the repository root, using installed NumPy/voice dependencies:

```sh
npm run build
uv run --frozen python -m benchmarks.stability.bounds \
  --output benchmarks/stability/capture-bounds.json
uv run --frozen python -m unittest tests.buffer_acceptance_test tests.wake_socket_test
```

`--occupancy-only` skips the historical contract suites. Their exit codes remain
separate from the new `occupancy` evidence. The checked-in
[fixture report](../benchmarks/stability/capture-bounds.json) identifies the Git
parent, exact source hashes, fixture service and effective configuration. It uses
16 kHz mono synthetic PCM, external model/audio fixtures, 750 ms configured
pre-roll, a one-second maximum utterance and unchanged wake threshold 0.2.
No live service, physical capture, model acquisition or long idle run is involved.
The fixture replaces external libraries/devices; production input, worker,
parent cancellation, resampling call sites and audio sockets execute normally.

## Measurement and limits

Setting `JARVIS_BUFFER_DIAGNOSTICS` to a writable report path opts the audio
service into diagnostics. Without it there is no occupancy emission or file I/O.
The capture loop observes growth and clear points synchronously and retains only
six counter records, frame/overwrite counters and lifecycle state. Checkpoints
travel over the existing bounded worker pipe after each input block and at decode
and release. The parent atomically replaces a report retaining at most 32
operation summaries. No waveform, question, transcript, prompt or audio fingerprint
is retained. Source hashes identify code, not conversation content.

The units are scalar PCM samples and sample payload bytes (raw s16 interleaved
samples: two bytes; other buffers: mono float32, four bytes). A partial raw sample
rounds up in the sample count; byte counts stay exact. These are **logical payload
occupancies**, not heap-allocation totals. Array views can retain larger backing
arrays, and concatenation/conversion temporarily duplicates payload. Those copies
and array/container metadata are not measured by these counters. The utterance
list and its concatenated handoff are measured separately: they coexist during
decode. Do not sum independently timed maxima and call the result measured RSS.

| Buffer | Diagnostic limit in samples | Basis |
| --- | --- | --- |
| Raw PCM accumulator | `(input_rate // 50 + 1) * channels` | One 20 ms read plus partial interleaved frame |
| Resampled pending | 1,343 | 511 pending + nominal 320-sample input block + 512-sample resampler output allowance |
| Wake accumulator | 1,791 | At most 1,279 pending + one 512-sample frame before slicing |
| Pre-roll | `floor(pre_roll_ms * 16 / 512) * 512` | Actual deque capacity; default 23 frames, 11,776 samples, 47,104 bytes (736 ms) |
| Utterance and handoff, separately | `seconds * 16000 + pre_roll_capacity + 512` | Nominal real-time duration + pre-roll + final frame; 28,288 samples each in this fixture |

The resampler allowance is a diagnostic envelope, not proof about native soxr
buffering. The duration limit is a wall-clock loop bound, not an enforced sample
quota: an accelerated/bursty producer can exceed the nominal sample budget. Such
an observation **fails** the report; the collector never increases a limit or
changes capture behavior to obtain a pass. External resampler fault fixtures
exercise that failure. Real source rates, real soxr behavior and native allocations
need their own evidence; this fixture only covers the recorded configuration.

## Finite coverage and verdicts

The report requires all eight operation identities, positive observed frame
counts, all six buffer records per operation, expected lifecycle outcomes and
new generations after cancellation. Missing/unobserved buffers are unvalidated;
bound violations fail. The run cannot complete successfully unless every required
occupancy verdict passes. Startup invalidates an earlier report before full
argument validation. Failed, interrupted or invalid invocations cannot leave an
old completed pass at the requested path.

- Synthetic idle supplies more than 100 overwritten frames beyond the pre-roll
  capacity, followed by wake plus an immediate question. The external recognizer
  requires all 6,400 question samples and rejects excessive ambient retention;
  the runner checks the result transiently and persists only the verdict.
- Manual activation cancels an owning idle wake, drains the cue, then opens a
  fresh capture. Its canceled response must retain the old identity and cannot
  become a question in the new operation.
- Manual endpoint capture and paced sustained speech exercise distinct endpoint
  and maximum-duration outcomes. Normal return releases the capture frame and
  all its arrays/views before emitting the released/zero-current observation.
- Lock, software mute and owning socket disconnect destroy the worker/capture.
  The report preserves last observed occupancies and marks `worker_terminated`;
  it does **not** manufacture zero observations or imply physical heap erasure.
  Unlock/unmute alone must not recreate capture. A deliberate final wake succeeds
  in a new generation without replaying old question events.
- Worker-pipe fault fixtures inject stale operation IDs, generations and capture
  sequences with impossible peaks. The parent rejects these; a new sequence also
  separates repeated operation IDs in the same worker generation. Fault fixtures
  also remove observations and make external resampling exceed the budget.

Checkpoint delivery can lag behind mutations when a worker is killed. A terminated
operation's last received peak is partial evidence; it is not a completed capture
bound pass. Normal completed captures include the final aggregated peak. The
lifecycle gate passes termination/recovery behavior separately. The buffer maxima
screen includes all received cancellation observations, without claiming unseen
post-checkpoint mutations. Pipe draining after generation invalidation prevents
queued diagnostics from blocking the privacy barrier; stale events invoke no
callbacks or persistence.

Unvalidated: openWakeWord internal inference buffers; native resampler, VAD and
recognizer allocations; Piper synthesis; OS/PipeWire queues; array backing storage,
conversion temporaries and all other unmeasured queues; real hardware behavior;
physical heap erasure. The broader network audit remains separate. No new physical
or release pass is claimed.

## Delivered observations and review

The published fixture observes peaks of 640 raw-accumulator bytes, 3,072 resampled
pending bytes, 6,144 wake-accumulator bytes and 47,104 pre-roll bytes. Retained
utterance and concatenated handoff each peak at 94,208 bytes. All stay within the
recorded diagnostic limits. Each normal operation reports zero current payload
on release. Four canceled captures retain partial observed counters with explicit
unvalidated per-buffer verdicts and a passed process-termination/recovery gate.
Buffers never used by an operation also remain unvalidated for that operation.

Review comparison: `git diff d2e56dd4c01a8e39e31c87025f0cbe00b22fa777...HEAD`,
implementation `56b9b2e` and correction `a6bdc9f`. The command regression first
reproduced the malformed trailing duplicate `--output` case leaving an old pass,
then passed after invalidation moved ahead of argument parsing. Separate missing
observations, bound overflow and stale-identity regressions were also red before
the corresponding implementation/fault fixture and green afterward.

### Standards

Independent review and correction recheck: **0 remaining findings**. No documented
standard violation or material baseline smell remains.

### Spec

Independent review and correction recheck: **0 remaining findings**. The stale
report finding is fixed; native/backend, network and physical coverage remain
explicitly outside this implementation's passing verdict.

Validation: `npm run check` passes; full `npm test` passes **211 Node / 64 Python tests**. The focused CLI and wake socket suites pass; the final bounds command passes its historical contract groups and scoped production payload/lifecycle screen. Standards: 0 remaining findings; Spec: 0 remaining findings.
