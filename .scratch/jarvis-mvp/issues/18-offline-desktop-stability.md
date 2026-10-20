# 18: Offline and desktop stability acceptance

**What to build:** Verify prolonged private conversation and idle operation survive ordinary desktop failures and work with external connectivity disconnected.

**Blocked by:** 05: Conversation expiry and explicit extension; 11: Concise speech and temporary text answers; 12: Login startup, KDE activation, and device recovery — M3; 15: Real playback delivery in follow-up context.

**Status:** ready-for-human

**Resolution:** closed — delivered implementation/tooling; remaining acceptance tracked in #12/#17/#19.

Claimed by Codex for implementation and acceptance evidence, 2026-10-19.

- [ ] Run a two-hour idle soak showing bounded CPU/RAM, queues, buffers, and log growth with no ambient STT/LLM invocation or retained conversation content.
- [ ] Complete a 30-turn follow-up conversation and extended sessions with explicit renewal, verifying noise deadlines, context continuity, expiry, and cleanup.
- [ ] Exercise systemd/service restart, microphone/backend disconnect/reconnect, suspend/resume, and stalled operations; recovered services never replay canceled questions or replies.
- [ ] With real devices, verify lock/mute immediately stops capture/playback, independent inhibitions remain effective, and readiness restoration cannot resume prior work.
- [ ] Using preinstalled local models, repeat representative activation/question/follow-up/text/closure flows with external connectivity disconnected; loopback services remain available and no cloud/tool request occurs.
- [ ] Run cancellation/interruption scenarios and confirm delivery-context limits and clearing of temporary text/audio access; this suite does not claim acoustic spoken-stop acceptance in place of its separate ticket.
- [x] Document setup, exact test procedures/commands, durations, environment, reproducible results, and every failure or unavailable scenario as failed/unvalidated rather than implying success.


## Answer

Acceptance tooling and synthetic evidence delivered; **physical and full soak
acceptance remain open**. See [the report](../../../docs/stability-acceptance.md)
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
