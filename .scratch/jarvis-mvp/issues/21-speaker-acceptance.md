# 21: Separate speaker acceptance

**Type:** Acoustic acceptance

**Status:** ready-for-human

**Claimed by:** Unclaimed

**Blocked by:** 17: Stable selected manual headset configuration before speaker trials.

**What to validate:** Determine whether the same manual voice path is useful and
private with speakers. Speaker support is a separate outcome and does not block
a headset-only release; absent evidence remains explicitly unvalidated.

## Acceptance criteria

- [ ] Record actual speakers/microphone, room/gain, device identifiers, candidate
  SHA, model hashes and configuration; do not inherit headset acoustic passes.
- [ ] Run #17's conversational, German quality and audible latency scenarios on
  speakers, including quiet/noisy operation and assistant playback echo. Record
  false activation/control events and follow-up contamination.
- [ ] Verify actual capture/output cessation, lock/mute, manual stop/replacement,
  device recovery and no replay using #12/#18 procedures; link shared evidence.
- [ ] Coordinate optional spoken-stop trials with #14 and wake trials with #13;
  leave each disabled/unvalidated unless independently accepted. General barge-in
  and acoustic echo-cancellation implementation are not implied by this ticket.
- [ ] Publish speaker-specific passed/failed/unvalidated requirements and limitations
  in the release checklist. Open focused bug tickets for failures; retain an
  explicit unsupported/unvalidated verdict if speaker support is deferred.

## References

- [Desktop acceptance](../../../docs/desktop-acceptance.md)
- [Latency scenarios](../../../docs/latency-benchmarks.md)
- [Release checklist](../../../docs/release-checklist.md)
- [Map and next-work order](../map.md)

## Comments

2026-10-19: Speaker portions of #12/#17/#18 are coordinated here. Original criteria
and measured evidence remain in their source tickets; this move grants no passes.
