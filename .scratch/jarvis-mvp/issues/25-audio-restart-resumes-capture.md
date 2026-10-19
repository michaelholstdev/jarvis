# 25: Audio-service recovery starts microphone capture without activation

**Type:** Bug

**Status:** ready-for-human

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

- [ ] After audio transport/service loss in voice mode, cleanup and readiness
  recovery do not initiate microphone capture, inference or playback on their own.
- [ ] Preserve existing bounded retry/context behavior while the conversation
  remains open (#07); a new deliberate activation can start a fresh microphone
  turn. Lock/mute closure and ordinary successful follow-ups remain unchanged.
- [ ] Dispatch each recognition operation at most once, including when readiness,
  privacy cleanup, ticker and CLI health/control requests overlap during recovery.
- [ ] Reproduce red/green at the agreed public CLI/service socket seam in temporary
  XDG runtime directories; verify automatic successful follow-ups still work.
- [ ] Run relevant checks and full regressions, review, then repeat the actual
  audio-crash/headset acceptance trial before marking #12's restart check passed.

## Comments

Claimed during #12 acceptance. No further crash injector is armed. Avoid further
live crash trials until recovery is corrected. Desktop source/backend loss and
lock/mute have their own privacy guard; do not weaken those paths to fix this.

Map: [MVP implementation map](../map.md).

## Answer

Software correction implemented; actual headset re-test remains open. At the
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
Independent Standards/Spec review and deployment/headset rerun follow next.
The original real failure above is retained; #12 is not marked passed.
