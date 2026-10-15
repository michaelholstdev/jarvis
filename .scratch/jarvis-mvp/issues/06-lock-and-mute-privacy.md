# 06: Lock and mute privacy controls

**What to build:** Lock or mute Jarvis at any point to stop listening and speaking, cancel work, and clear the conversation; restore readiness without resuming anything.

**Blocked by:** 04: Manual replacement and delivered-reply context.

**Status:** ready-for-agent

- [x] Lock or mute independently inhibits microphone capture, stops playback, cancels recognition/generation/synthesis, and closes the conversation.
- [x] Temporary audio, pre-roll, context, and any current-session answer access are cleared on inhibition; no late canceled result restores them.
- [x] Activation and ambient processing cannot bypass an active inhibition, including while acknowledgment or cleanup is in progress.
- [x] Unlocking or unmuting restores activation readiness only when every inhibition has cleared; old work and context never resume.
- [x] Hardware-mute signals are represented at the public desktop/audio boundary and respected; actual KDE/device signal integration is validated in the desktop ticket.
- [x] Public-interface tests apply both inhibitions in different orders and during each active state, including simultaneous inhibition and stale playback/inference events.
- [x] Document mute controls, locked/muted versus idle behavior, independent inhibition precedence, and the distinction between simulated signals and real desktop verification.

## Comments

Claimed for implementation. Test seams: the spec’s public `createCore` orchestration interface with a fake clock, plus the versioned daemon/audio socket boundary for simulated privacy signals. Review baseline: `1dac1959d3b290526d888466deb42aeebba9cf03`.


## Answer

Implemented independent desktop lock, software mute and hardware-mute conditions
at the public orchestration and versioned socket boundaries. Any inhibition
invalidates all current work, clears session text/context/timers, and requests a
silent audio privacy barrier. Activation remains unavailable until every flag
clears and the latest barrier completes. Canceled results cannot restore content
or affect a fresh conversation. Cleanup failure and audio reconnection preserve
the barrier and inhibitions. The Python mock clears delivery tracking and gates
all ordinary audio operations. CLI controls, health flags, and protocol/README
documentation distinguish ordinary idle from inhibition and simulated signals
from real KDE/device verification, which remains ticket #12.

Public fake-clock checks cover all three flags during every active phase,
precedence/release orders, stale inference/playback/onset, extension phases,
cleanup timeout and reconnect. Socket checks cover the actual Python gate and a
delayed peer with overlapping inhibitions, pending cleanup and fresh activation
before the old transport completes. Implementation map links this resolution.


### Review and validation

Full validation: `npm run check` and `npm test` pass (100 Node tests,
3 Python tests). Independent code-review axes used baseline
`1dac1959d3b290526d888466deb42aeebba9cf03` and implementation commit `f01651a`.
Standards found no hard violations and one low-priority duplicated inhibition
schema; consolidated it into a shared Draft 7 definition. The standards reviewer
confirmed the fix with zero outstanding findings. Spec review found zero
missing, incorrect or out-of-scope requirements. After schema consolidation,
`npm run check` and all 50 privacy/transport regression tests pass.
Real KDE/device verification remains explicitly unvalidated in ticket #12.
