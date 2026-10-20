# 14: Spoken stop and acoustic acceptance

**What to build:** Say standalone “Stopp” during a spoken reply to silence playback and continue in the normal follow-up window, with manual cancellation retained when voice stop is unreliable.

**Blocked by:** 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-human

## Remaining work plan — 2026-10-19

**Type:** Acoustic acceptance

**Outcome:** Measure standalone spoken-stop reliability, delay and false stops
separately on actual headset and speakers, using the existing acoustic protocol.
Manual cancellation remains independently usable. Keep this separate from basic
headset acceptance so an unvalidated/failed FR-09 is visible as a release gap.
Share compatible fixtures/results with #17/#21; do not duplicate trials or claim
general barge-in. Final trials use the selected production configuration.

#19 may consider a limited manual release with an explicit FR-09 gap; successful
spoken stop is required before claiming that P0 requirement passed.


- [x] Provide bounded microphone processing for the narrowly scoped stop control during playback without enabling general voice barge-in or indefinite ambient transcription.
- [x] Only a validated standalone spoken “Stopp” stops the reply; quoted/embedded words, playback echo, and VAD activity alone do not establish a control intent.
- [x] Voice stop cancels remaining reply work, retains delivered-reply semantics, and starts the default follow-up window when playback stops.
- [x] Manual cancellation remains usable independently of voice recognition; cancellation and late-result protections are exercised through the existing public interface.
- [ ] Acoustic tests on the actual headset and speakers report stop-detection reliability, response delay, and false stops during representative assistant/background playback, with reproducible fixtures and settings.
- [x] Record spoken-stop FR-09 as passed, failed, or unvalidated separately for each setup; manual-only cancellation cannot pass the spoken criterion. If unreliable, document the gap and retain manual controls without claiming general barge-in.
- [x] Document any needed local control-recognition dependencies/models, licenses/checksums, installation/configuration, test commands, enable/disable behavior, calibration limits, and safe fallback.

## Comments

Claimed by Codex for implementation. Public runtime/conversation and control-recognition test seams approved; review baseline `2490ce7393a1dc4e5c81a3f5d68e07902c4a6c52`. Actual headset/speaker acceptance must remain explicit.

## Answer

Implementation complete; **physical acoustic acceptance remains open**. Experimental
`features.voice_stop` defaults to false. The resident CPU recognizer processes only
bounded playback control windows, requiring a silence boundary and a complete
standalone command. Synthesized-reference correlation and a reply-word veto reject
likely echo; real acoustic reliability is not inferred from these guards.

An operation-scoped socket control event uses the existing cancellation path and
starts follow-up after cancellation acknowledgment. Fully drained sentence prefixes
are retained; the partially heard current sentence is omitted. Manual stop,
replacement, late-result rejection and lock/mute cleanup remain independent.

See [spoken-stop guide](../../../docs/spoken-stop.md) for exact settings, existing
pinned dependency/model installation and licenses, calibration limits, fixed fixtures,
the opt-in acoustic trial command and safe fallback. Headset FR-09: **unvalidated**;
speaker FR-09: **unvalidated**. No physical acoustic trials were performed. The
unchecked acoustic measurement criterion requires the maintainer's actual devices
and consented speech/background fixtures; manual cancellation cannot pass it.

### Standards review

One initial architecture finding (per-answer model loading) resolved by reusing the
resident recognizer. Re-review: zero remaining standards findings.

### Spec review

Two initial code findings resolved: speech crossing a capture boundary must first
reach silence before rearming, and ordinary bounded question recognition retains
its prior behavior. Re-review: zero remaining code findings. One acceptance item
remains: actual headset/speaker reliability, audible response delay and false stops.

Map pointer: [implementation map](../map.md).

### Validation

- `npm run check` passed (TypeScript, Biome, Ruff, strict Python typing).
- Final `npm test` passed: **184 Node tests and 17 Python tests**.
- Focused spoken-stop/runtime, output-cancellation and control-recognition tests
  passed; synthetic delayed/scaled echo and cross-window continuation fixtures
  are automated. Acoustic correlation requires the input extra; it ran here.
- `scripts/verify-stop.py --help`, script Ruff checks and `git diff --check` passed.
- Hardware trials were not run; this ticket stays `ready-for-human`, not resolved.

## Review follow-up

The fresh review found a production disconnect sequence that lost the drained
sentence prefix, retained audio buffers after closure, and duplicated reply-word
veto logic. These code findings are fixed:

- Audio socket disconnect kills the worker while retaining only the matching
  operation ID and delivered character count for its pending cancel. Cancel
  consumes that metadata; privacy, later work and default cleanup erase it.
  Late worker events cannot restore metadata across a generation change.
- Synthesis/playback helpers scope temporary arrays, echo reference, PCM blocks
  and intermediate text to their operation; no speech waveform survives closure
  in the resident worker's main loop.
- Both command validation and monitor admission use one reply-word veto predicate.
- New real-audio-service socket tests cover spoken/manual stop, replacement,
  privacy erasure and consumed late cancellations. A worker-protocol lifecycle
  test observes waveform release while the process is still waiting idle.

The user explicitly requested code fixes now and hardware acceptance later.
Actual headset and speaker FR-09 remain **unvalidated** and the ticket remains
`ready-for-human`; no acoustic acceptance pass is claimed.

Review-fix validation: `npm run check` passed; full `npm test` passed **188 Node
and 18 Python tests**. The real-service socket test and resident worker waveform
lifecycle test both failed on the reviewed code and passed after the fixes.
After tightening fixture synchronization, all four real-service cases passed again.
Follow-up Standards review: zero remaining findings. Follow-up Spec review: zero
remaining actionable code findings; acoustic acceptance remains deferred.
