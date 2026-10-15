# 07: Failures, explicit retry, and capability recovery

**What to build:** Understand a failed turn through a brief indication and CLI health, recover local services safely, and retry only when you explicitly request it.

**Blocked by:** 04: Manual replacement and delivered-reply context.

**Status:** ready-for-agent

- [x] Unavailable wake detection reports manual activation available; unavailable STT/TTS reports voice conversation unavailable, and Ollama failure reports the unavailable inference capability.
- [x] An active-turn failure gives one brief indication where possible and retains context while the conversation remains open; idle failures do not produce repeated audible announcements.
- [x] Standalone “Noch einmal” retries the available unsuccessful question, or a new question starts new work; service recovery alone never replays a question.
- [x] Real local-socket disconnect/reconnect, process failure, operation timeout, and stalled-audio watchdog cases recover or expose degraded health without busy loops or stale reply delivery.
- [x] Backpressure and queue limits prevent unbounded pending control/audio work; failure diagnostics and bounded logs contain no user content.
- [x] Public-boundary and socket-contract checks prove explicit retry, unavailable capabilities, bounded recovery, queue limits, and immunity to canceled results.
- [x] Document capability states, troubleshooting, watchdog/restart settings, service-recovery commands, and exact health/log-inspection steps.


## Comments

Implemented on the current branch against baseline `9531e83`. Tests use the
already agreed public conversation-core and real socket contract seams.

## Answer

Implemented explicit unsuccessful-question retry, one simulated failure cue
following confirmed cancellation, capability-specific health, and bounded
background audio recovery. Failed socket exchanges retain completed context and
the unsuccessful question only while the conversation remains open. Recovery
cannot replay a question; only standalone “Noch einmal” or a new question starts
work. Watchdogs cancel stalled inference/synthesis/playback; failed cancellation
or cue degrades audio without a retry loop. Late results and stale readiness
probes cannot affect current work or cross privacy generations.

Outbound frame bounds, existing connection/time bounds, coalesced probes and
privacy workers limit pending work. Routine diagnostics drop excess output
beyond 100 lines per 30 seconds and never buffer user content. Added recovery,
capability, watchdog, log collection and restart documentation in
`docs/recovery.md`, the protocol, configuration reference and README.

Voice, inference and cues remain simulated. Real Ollama/STT/TTS, device
hotplug/suspend, acoustic cues and installed systemd user units remain their
later adapter/hardware tickets; no real capability or measurement is claimed.

Map pointer: [implementation map](../map.md).

Validation: `npm run check` passed (TypeScript, Biome, Ruff, mypy);
`npm test` passed (117 Node tests, 3 Python tests). Focused socket contracts also
passed after adding explicit Python mock-capability advertisement. Tests cover
explicit retry, new questions, zero/partial playback failure, cancellation,
stale successes/failures, service disconnect/reconnect and timeout, privacy
races, connection/frame capacity and bounded diagnostic flooding. The older
expiry-watchdog assertion now expects cancellation followed by degraded audio
on missing acknowledgment, matching this ticket's failure behavior.

Review corrections: unsolicited incomplete playback retains its unsuccessful
question and emits one cue; explicit privacy/closure errors fail the exchange
immediately instead of retrying the same cleanup operation. Both have regression
coverage. Spec review verified the correction and reports no remaining findings.
Standards review also reports no remaining actionable findings after the cleanup
error correction. Both review axes used the code-review skill against baseline
`9531e83`; implementation validation was run by the primary agent.


### Follow-up review corrections

Fixed the P1 unconfirmed-cancellation recovery finding: an outstanding audio
cleanup barrier now survives socket loss, cancellation timeout, reconnect and
conversation expiry. A healthy hello cannot release readiness; the current
silent stop-all acknowledgment is required. Core context and retry retain their
original expiry, and lock/mute supersede recovery cleanup without allowing stale
acknowledgments to release either gate. Health exposes `audio_cleanup_pending`.
Public-core and real-socket regressions cover the reported sequence, failed
cleanup, expiry, stale reports and privacy precedence.

Fixed the P3 duplicated classification finding by sharing operation-to-capability
mapping between adapter availability checks, service errors and core watchdogs.

Correction validation: `npm run check` passed; `npm test` passed (121 Node tests,
3 Python tests). Independent targeted Standards and Spec reviews confirmed both
findings resolved with no remaining actionable findings in the correction.
