# 25: Audio-service recovery starts microphone capture without activation

**Type:** Bug

**Status:** ready-for-human

**Resolution:** Implemented, reviewed and confirmed in the actual headset crash rerun.

**Claimed by:** Codex

**Blocked by:** None

## Observed failure

During #12 headset acceptance on `4b76547`, audio main process was deliberately
SIGKILLed during playback at 12:59:13 UTC. User confirms speech stopped at four.
Systemd restarted audio after 15 seconds; it became ready at 12:59:32.

Without another activation, core then dispatched `recognize` twice with the same
operation ID `20`, received `busy`, played a failure cue and started another
follow-up capture. A real `pw-record` stream targeting the selected microphone
was present at 12:59:50. Core still exposed the interrupted answer as temporary
text. The active conversation was explicitly closed using CLI mute/unmute after
discovery; post-cleanup state is idle/ready with no capture streams.

No old answer replay was observed, but recovery itself caused new capture. This
fails #12's remaining-work requirement: readiness recovery "without replay or
resumed capture". It is not a successful restart/privacy acceptance result.

## Acceptance criteria

- [x] After audio transport/service loss in voice mode, cleanup and readiness
  recovery do not initiate microphone capture, inference or answer/extension
  playback on their own, including at conversation-duration expiry. Normal
  configured conversation-end cues remain part of bounded closure.
- [x] Preserve existing bounded retry/context behavior while the conversation
  remains open (#07); a new deliberate activation can start a fresh microphone
  turn. Lock/mute closure and ordinary successful follow-ups remain unchanged.
- [x] Dispatch each recognition operation at most once, including when readiness,
  privacy cleanup, ticker and CLI health/control requests overlap during recovery.
- [x] Reproduce red/green at the agreed public CLI/service socket seam in temporary
  XDG runtime directories; verify automatic successful follow-ups still work.
- [x] Run relevant checks and full regressions, review, then repeat the actual
  audio-crash/headset acceptance trial before marking #12's restart check passed.

## Comments

Claimed during #12 acceptance. No further crash injector is armed. Avoid further
live crash trials until recovery is corrected. Desktop source/backend loss and
lock/mute have their own privacy guard; do not weaken those paths to fix this.

Map: [MVP implementation map](../map.md).

## Answer

Software correction implemented and actual headset crash re-test passed. At the
recorded pre-fix baseline `4b76547`, the new public CLI/socket regression failed
with three recognition requests instead of one after a simulated audio restart.
After the fix it passes: voice recovery creates no recognition operation from
either readiness or cleanup acknowledgment, including repeated health probes.
A new deliberate activation starts exactly one capture. Retry availability,
existing follow-up deadline and context remain bounded; ordinary successful
voice follow-ups and the scripted mock recovery behavior remain unchanged.

The live duplicate dispatch occurred because recovery queued recognition while
privacy cleanup and the ticker could both drive it. Removing that automatically
queued microphone work eliminates the duplicate on this recovery path; no new
worker queue or concurrency abstraction is introduced.

Validation: `npm run check` passed; full `npm test` passed **205 Node + 42 Python**
tests. Focused restart, recovery and successful voice-follow-up suites passed.
The follow-up below records final validation, review and headset rerun.
The original real failure above is retained; this does not close all of #12.

Review follow-up: Standards found no issues. Spec identified duration expiry
opening an extension prompt after recovery, which would restart capture. A new
public-Core regression reproduced that failure with a fake clock; the follow-up
fix requires an active follow-up recognition operation before prompting on timer
expiry. It passes along with ordinary expiry and recovery tests. Explicit
activation can still request extension, and the original follow-up deadline
continues to bound retained context. Final `npm run check` and full `npm test`
pass with **206 Node + 42 Python** tests. Both Standards and Spec re-reviews of
`4b76547...f5fd4f8` report **0 remaining findings**. Corrected core is deployed for
the headset re-test; the original failure remains recorded above.

Actual headset rerun on `f5fd4f8`: user manually SIGKILLed audio during playback
at 15:12:39 UTC; systemd scheduled restart at 15:12:54, audio ready at 15:12:58.
The cleanup barrier completed without any new `recognize` operation. The original
follow-up allowance then expired, closing context with the configured end cue.
At 15:13:25 both services running, core idle/ready, no capture streams, no pending
privacy/audio cleanup and no resumed answer. User confirms the speech stayed off.
This passes the affected playback/crash case; other #12 permutations stay explicit
in [the session evidence](../desktop-acceptance-2026-10-19.md).
