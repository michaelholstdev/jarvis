# 18: Offline and desktop stability acceptance

**What to build:** Verify prolonged private conversation and idle operation survive ordinary desktop failures and work with external connectivity disconnected.

**Blocked by:** None for the buffer-instrumentation implementation below. Final physical/release acceptance still depends on #12 desktop privacy/recovery and #17 selected headset configuration.

**Status:** ready-for-human

**Resolution:** closed — delivered implementation/tooling; remaining acceptance tracked in #12/#17/#19.

## Current implementation scope — user decision, 2026-10-20

**Type:** Instrumentation implementation

**Next task:** Implement content-free buffer occupancy evidence before the next
physical headset trials. The user selected this next step after #13 and requested
this issue be prepared for a fresh context. Preparation is complete; this section
specifies implementation work still to do. Earlier claims, reviews and
`ready-for-human` statements below describe delivered tooling or final acceptance,
not a current implementation claim. Claim this scoped follow-up before starting.

### Starting point and boundaries

- #13 is implemented and reviewed in `fed827a` / `d2e56dd`. Real voice wake now
  defaults enabled, threshold **0.2**. Measured headset recall **23/30 (76.7%)**
  is accepted for experimental use; do not recalibrate it or reopen that decision.
- `benchmarks/stability/bounds.py` currently wraps existing socket/worker tests;
  it does **not** observe production audio buffer occupancy. Passing its checks
  or observing low RSS is not occupancy evidence.
- Relevant production paths: `apps/audio/input.py` (raw PCM, resampler pending,
  1280-sample wake-frame accumulator, overwritten pre-roll and utterance),
  `apps/audio/wake.py`, `apps/audio/output_worker.py`, `apps/audio/output.py`,
  and `apps/audio/main.py`. Existing fixtures are in `tests/fixtures/wake/`,
  `tests/wake_socket_test.py`, `tests/wake-runtime.test.ts` and
  `tests/worker_privacy_test.py`.
- Read [stability follow-up](../../../docs/stability-follow-up.md),
  [wake implementation](../../../docs/wake-activation.md) and
  [stability protocol](../../../docs/stability-acceptance.md). The old follow-up
  table uses the pre-#13 pre-roll calculation; audit current code/config instead
  of copying that historical number. Default pre-roll now holds 23 frames of
  512 float32 samples (736 ms / 47,104 sample bytes).
- Record the actual task-start Git revision for implementation/review. The old
  `afc5ac...` baseline below belongs to the previous tooling change.
- Preserve all preexisting working-tree changes, including tracker edits and
  local calibration/validation records. Do not reconfigure/restart live services,
  open physical capture, acquire models or start another long idle run.

### Deliverables and acceptance criteria

- [ ] Add opt-in diagnostic instrumentation to the **production capture path**
  that measures current occupancy and high-water marks for Jarvis-owned raw PCM,
  resampled pending frames, wake-frame accumulation, pre-roll and retained
  utterance/handoff audio. Record samples/bytes and configured or derived limits
  with explicit units. Observe growth/clear points so a transient peak is not
  hidden by periodic sampling; keep the instrumentation itself bounded.
- [ ] Keep diagnostics content-free: counters, limits, operation/generation
  identity and lifecycle outcomes only. No PCM, transcripts, prompts, question
  text or content-derived fingerprints. Normal operation must not gain per-frame
  logging or persistent ambient recording. Diagnostics must not preserve old
  audio or alter wake defaults, thresholds, cue timing or capture handoff.
- [ ] Extend the existing acceptance CLI/report path (prefer
  `benchmarks.stability.bounds`) with a reproducible finite fixture run that
  consumes those actual production observations. Include candidate/config
  identity, coverage, observed maxima, limits and passed/failed/unvalidated
  verdicts. Separate prior contract-test results from new occupancy evidence;
  mark unobserved buffers unvalidated. Failed/interrupted/invalid runs invalidate
  previous passing reports and cannot publish a completed passing verdict.
- [ ] Exercise sustained synthetic idle longer than the pre-roll window,
  immediate wake-plus-question handoff, manual activation interaction, endpoint
  and maximum-duration capture, plus lock/software-mute cancellation, owning
  socket disconnect and recovery. Show overwrite rather than accumulation, no
  question onset loss, temporary-buffer release at completion/cancellation, and
  rejection of stale observations/events across operations or generations.
  Process termination is lifecycle evidence, not a claim of physical heap erasure.
- [ ] Test through the already agreed **acceptance CLI/report** and
  **daemon/audio socket** seams, reusing deterministic external audio/model
  fixtures. Tests must exercise the instrumented production path; do not infer
  occupancy solely from configured constants, a parallel ring implementation,
  mocked Jarvis internals or test exit codes. Include failure/missing-observation
  cases that prevent a false pass. These fixtures require no human speech.
- [ ] Update bounds documentation and publish a content-free fixture report with
  reproducible commands and precise coverage. Identify openWakeWord's internal
  inference buffers, native resampler/VAD/model allocations, Piper synthesis,
  OS/PipeWire buffers and other unmeasured queues separately; this focused
  implementation does not establish complete native/backend occupancy or full
  #18 acceptance. Record observed bound violations as failures rather than
  silently increasing limits or changing behavior to make a report pass.
- [ ] Run focused checks during implementation, `npm run check`, the full test
  suite at completion and the implementation skill's Standards/Spec review.
  Commit only this scoped work, preserving unrelated existing changes. Append
  results under `## Comments` and update the map; retain the historical evidence.

**Out of this follow-up:** expanding the network audit to datagrams/inherited
connections, installing/running `strace`, physical/headset/speaker trials, final
LLM selection, release sign-off, new features or wake recalibration. The current
connection-only audit and its disclosed coverage gaps remain separate open #18
work. A broader audit can be scoped later; it is not part of this buffer task.

**After delivery:** mark the instrumentation outcome separately from remaining
physical/privacy/network coverage. Return #18 to `ready-for-human` if only those
acceptance steps remain; do not close it or mark mandatory gates passed merely
because the fixture report passes. The user-waived two-hour idle duration stays
waived; preserve the 44.02-minute observation as partial evidence.

## Remaining work plan — 2026-10-19

**Type:** Acceptance

**Outcome:** Complete remaining stability and privacy evidence on the selected manual
headset configuration. Existing synthetic offline results remain valid only for
their recorded setup; they do not replace final candidate evidence.

- The two-hour idle run is waived by the user (2026-10-19); retain the existing
  44.02-minute observation as partial evidence, not a completed two-hour pass.
- [ ] Complete explicit bounded queue/buffer occupancy evidence independently
  of the waived long idle run.
- [ ] Complete 30 physical contextual turns plus extension, interruption,
  delivered-context, text cleanup and disconnected local operation on the chosen
  setup. Share applicable session evidence with #17.
- [ ] Audit external request attempts separately from blocked external routes;
  document method, coverage and verdict without retaining conversation content.
- [ ] Import physical lock/mute/recovery evidence from #12 instead of duplicating
  its session. Record remaining failures/unvalidated coverage explicitly.

Agent instrumentation/preparation can proceed independently; final hardware
acceptance uses the configuration selected by #17. Speaker coverage is #21.
Use [existing commands and protocols](../../../docs/stability-acceptance.md).


Claimed by Codex for implementation and acceptance evidence, 2026-10-19.

- Two-hour idle soak: **waived by the user, 2026-10-19**; no longer a closure blocker. Existing 44.02-minute RSS/log observations remain partial; final CPU and queue/buffer verdicts are not established by that run. Queue/buffer and idle privacy checks remain required.
- [ ] Complete a 30-turn follow-up conversation and extended sessions with explicit renewal, verifying noise deadlines, context continuity, expiry, and cleanup.
- [ ] Exercise systemd/service restart, microphone/backend disconnect/reconnect, suspend/resume, and stalled operations; recovered services never replay canceled questions or replies.
- [ ] With real devices, verify lock/mute immediately stops capture/playback, independent inhibitions remain effective, and readiness restoration cannot resume prior work.
- [ ] Using preinstalled local models, repeat representative activation/question/follow-up/text/closure flows with external connectivity disconnected; loopback services remain available and no cloud/tool request occurs.
- [ ] Run cancellation/interruption scenarios and confirm delivery-context limits and clearing of temporary text/audio access; this suite does not claim acoustic spoken-stop acceptance in place of its separate ticket.
- [x] Document setup, exact test procedures/commands, durations, environment, reproducible results, and every failure or unavailable scenario as failed/unvalidated rather than implying success.


## Answer

Acceptance tooling and synthetic evidence delivered; **physical and remaining
privacy/resource acceptance remain open**. The two-hour idle run is waived by the
user; it is not a closure blocker or a passed test. See [the report](../../../docs/stability-acceptance.md)
and [map](../map.md).

- Added a configurable idle collector (two hours by default) with content-free
  resource/log observations and explicit unvalidated queue/buffer/device gates.
  The user requested stopping the corrected run; its last buffered checkpoint
  reports 44.02 minutes, RSS below the start and zero idle log bytes. It is
  explicitly incomplete, not a two-hour or final CPU pass.
- Added an isolated loopback-only offline runner using preinstalled models and
  private silent sinks. Initial + 30 actual synthetic Whisper/Ollama/Piper turns
  complete; separate extension/text/privacy/recovery/delivery/desktop and 30-turn
  contextual socket suites pass. Human German usefulness remains unvalidated
  (only 12/30 replies match the required-word screen).
- Added a 30-turn socket context/closure regression and command regressions for
  stale passing reports after failed reruns. Review found/fixed CPU undercount
  after worker exit and stale evidence. Both review axes have zero remaining
  implementation findings.
- `npm run check` and full `npm test` pass: **204 Node / 39 Python tests**.
- Real headset/speaker lock/mute, actual device/backend hotplug, installed systemd
  restart and suspend/resume remain unvalidated, with exact manual procedures.
  Internal queue/buffer occupancy and external-request-attempt auditing remain
  unvalidated. #14 acoustic spoken-stop acceptance is not claimed here.

Original mixed hardware acceptance checkboxes remain open where the available
evidence covers only software/synthetic behavior.


## Comments

2026-10-19: Partial real headset desktop privacy/recovery trials are recorded once
in [#12 session evidence](../desktop-acceptance-2026-10-19.md). Import only the
explicitly observed scenarios; hardware-mute detection is unsupported for this
setup and long speech overflow is open in #23. This does not close #12 or #18.

2026-10-19: The user requested omitting the two-hour idle test because the prior
roughly 40-minute observation showed no reported anomalies. Accepted as an
explicit duration waiver for #18 and its release checklist. Preserve the actual
44.02-minute checkpoint evidence and incomplete artifact; do not relabel it as a
two-hour or final CPU pass. Other privacy, queue/buffer, offline, conversation and
desktop recovery checks remain required.

Review follow-up: invalid zero, negative and non-finite `--seconds`/`--interval`
values now replace prior passing evidence with an incomplete failed report before
returning CLI usage error 2. Ten command-level regression cases reproduced the
finding before the fix and pass afterward. Both review axes rechecked the fix
without new findings. The user-stopped idle observation and open acceptance gates
are preserved.

Follow-up validation: `npm run check` and full `npm test` pass: 204 Node /
39 Python tests.


### Tooling follow-up — 2026-10-20

Claimed by Codex for tooling and automated evidence only, as confirmed by the
user. Review baseline: `afc5ac098c2678b1e4eabab2608088eac62d9668`. Confirmed seams:
acceptance CLI/report and daemon/audio sockets under excess input.

Added a reproducible bounds-evidence collector around existing public-contract
regressions, a content-free descendant connection-attempt audit CLI, and tracer
boundary regressions. Socket admission/frame and audio cancellation/duration
checks pass. Native buffer occupancy remains unvalidated. The actual audit cannot
run because `strace` is absent; its failed execution is retained, not a pass.
Connection-only tracing also cannot establish all external-request coverage.

Imported #12's setup-specific physical observations, including corrected #25
recovery and #23 long-answer reruns, without repeating hardware trials. Jieli
hardware mute remains unsupported. Final #17 configuration, 30 physical turns,
chosen-setup offline trials and remaining coverage stay open. No release pass or
new long-idle run is claimed. See [follow-up report](../../../docs/stability-follow-up.md)
and [existing map pointer](../map.md).


Follow-up validation: `npm run check` and full `npm test` pass (208 Node / 48
Python tests). Standards and Spec reviewers independently rechecked the stale
CLI-report correction and report zero remaining findings. Review details and
remaining acceptance gates are in the follow-up report. Tooling work is committed;
status remains ready-for-human for final candidate/physical evidence.

2026-10-20: Scoped buffer instrumentation claimed by Codex. Task-start/review baseline: `d2e56dd4c01a8e39e31c87025f0cbe00b22fa777`. Agreed seams: acceptance CLI/report and daemon/audio sockets. Existing working-tree edits preserved.

### Buffer occupancy instrumentation delivered — 2026-10-20

The current scoped instrumentation criteria are delivered. This outcome supersedes
its preparation/next-task wording above; full #18 acceptance remains open.
**Status: ready-for-human** for the remaining physical/privacy/network work.

Production capture now measures opt-in content-free logical payload occupancy and
high-water marks for raw PCM, resampled pending, wake accumulation, overwritten
pre-roll, utterance and concatenated handoff. The CLI consumes actual production
observations via isolated audio sockets with external device/model fixtures;
it separately records historical contract results. Eight finite scenarios cover
idle overwrite, immediate wake/question handoff, manual cancellation/cue/capture,
endpoint, maximum duration, lock, software mute, owner disconnect and deliberate
recovery. Stale identities/sequences are rejected; missing evidence and observed
bound violations cannot pass. Failed/interrupted/invalid reruns invalidate old
reports, including the review's malformed duplicate-output case.

See [method, measurements and review](../../../docs/capture-buffer-evidence.md),
[content-free fixture report](../../../benchmarks/stability/capture-bounds.json)
and [map](../map.md). Task baseline `d2e56dd`; implementation `56b9b2e`, correction
`a6bdc9f`. The report records exact source hashes and its Git parent. Pre-roll
peaks at 47,104 bytes; utterance and handoff each peak at 94,208 bytes. Canceled
captures retain partial observations with explicit unvalidated per-buffer
verdicts; worker termination is lifecycle evidence, never heap-erasure evidence.

Native inference/resampler/VAD/model allocations, synthesis, OS/PipeWire queues,
array backing storage/conversion copies and other unmeasured queues remain
unvalidated. This does not establish full buffer acceptance, expand the separate
network audit, perform hardware trials or select the final #17 configuration.
The two-hour duration remains waived; 44.02-minute evidence remains partial.

Validation: `npm run check` passes; full `npm test` passes **211 Node / 64 Python tests**. The focused CLI and wake socket suites pass; the final bounds command passes its historical contract groups and scoped production payload/lifecycle screen. Standards: 0 remaining findings; Spec: 0 remaining findings.

2026-10-20 review correction: Fixed the P3 verdict precedence finding. Received
sample/byte overflows now remain failed for canceled operations and aggregate
reports with missing records elsewhere. Unobserved/partial evidence remains
unvalidated when no violation is known. Three regression cases reproduced the
incorrect verdict before the fix and pass afterward. Updated
[method and fixture evidence](../../../docs/capture-buffer-evidence.md).
The existing ready-for-human status and remaining acceptance limits are unchanged.

Correction validation: `npm run check` and full `npm test` pass (**211 Node / 65 Python tests**); all 12 focused CLI/socket tests pass. The refreshed bounds report passes its scoped screen. Independent Standards and Spec rechecks report **0 remaining findings**.

### User-requested closure and handoff — 2026-10-20

The user requested closing #18 and moving directly to #17 in a fresh context.
**Resolution: closed for delivered implementation/tooling.** Implementation and
review fixes are committed through `ee483ce`; checks pass (211 Node / 65 Python),
with zero remaining Standards/Spec findings for that work.

This closure is a scope decision, not a full stability/privacy or release pass.
Remaining chosen-setup physical conversation/offline evidence follows #17 and
release acceptance #19; desktop/privacy recovery stays with #12. Broader network
attempt coverage and native/backend/other unmeasured buffer coverage remain
explicitly unvalidated in #19. Further instrumentation needs a separately scoped
follow-up. No criterion is relabeled passed. The two-hour idle waiver and actual
44.02-minute partial observation remain unchanged.

Next task: [#17 headset acceptance](17-latency-and-resource-benchmarks.md).
Fresh-context entry: [handoff](../headset-acceptance-handoff.md).
