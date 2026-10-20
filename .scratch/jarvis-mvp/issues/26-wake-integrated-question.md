# 26: Wake activates but attached question is not reliably answered

**Type:** Bug

**Status:** ready-for-agent

**Claimed by:** Codex

**Blocked by:** None

## Observed failure

During #17 headset acceptance on candidate `003847b`, the user reports that
"Hey Jarvis" activates the assistant but the immediately integrated question
is not correctly executed: the answer sounds like a greeting. Waiting after
the wake phrase appeared necessary. Wake threshold remains 0.2 by user decision.
The live transcript was not retained; no exact live spelling is inferred.

An offline replay through production `Input.recognize(wake=True)` with real
Parakeet, Silero, soxr and wake models reproduces question loss on existing
local calibration clip `headset-calibration-01/positive-00.wav`. Full decoding
gives six words; wake capture supplies 30720 samples from 1.824–3.744 seconds,
whose decoding gives one raw word and no question after wake-prefix removal.
The full-question tail assertion fails on repeated runs. This is related
evidence, not proof of the exact cause of the live greeting response.
The other nine calibration clips retain the full-decoding final three words.
These local calibration recordings are development data, not new held-out
acceptance evidence. No audio or human transcripts are added to the tracker.

## Acceptance criteria

- [ ] Reproduce and isolate the attached-question failure at the production
  audio/input boundary, distinguishing capture truncation, VAD and prefix handling.
- [ ] Correct the established cause with a regression that fails before the fix.
- [ ] Preserve bounded idle privacy, wake cancellation, manual activation and
  the approved experimental threshold; do not silently increase general latency.
- [ ] Re-run relevant checks and the actual headset wake-plus-question trial.

## Comments

Diagnosis in progress. Existing deterministic socket marker test passes and does
not reproduce the acoustic/model interaction. First real-model synthetic replay
retained its question but exposed an unhandled wake-prefix spelling; that alone
does not establish the live greeting cause.

Map: [MVP implementation map](../map.md). Parent: [#17](17-latency-and-resource-benchmarks.md).

### Narrowed diagnosis and configuration experiment

The failed clip contains digital silence after 3.744 s. Decoding 0–3.744 s
retains the question; decoding the actual 1.824–3.744 s wake slice gives only
one raw word. Adding 1 s zeros restores its question tail; 64–512 ms does not.
Padding was investigated offline only. Changing only pre-roll to 1000 ms
supplies 1.568–3.744 s and retains six raw words / four question words. This
supports recognizer sensitivity to shortened leading context, not proof that
question samples themselves were discarded or that the live greeting has the
same cause. Longer pre-roll requires no waiting for future audio.

Reproduction: [local real-model replay](../wake-handoff-replay.py), from repo root:

```sh
.venv/bin/python .scratch/jarvis-mvp/wake-handoff-replay.py --pre-roll-ms 750 0
.venv/bin/python .scratch/jarvis-mvp/wake-handoff-replay.py --pre-roll-ms 1000 0 1 2 3 4 5 6 7 8 9
```

First command exits 1 (zero question words); second exits 0 (tail retained in
10/10 development clips). This compares the last three words with full-file
decoding, not every word or human quality. File PCM substitutes for the external
capture process/device inventory; actual resampling, wake, VAD and recognition
remain. No microphone opens and no LLM is called. The existing socket test
`tests.wake_socket_test.WakeSocketTest.test_continuous_question_and_bounded_overwritten_preroll`
also passes. No application code or defaults changed.

Local `audio.pre_roll_ms` is now 1000 for a human rerun; threshold remains 0.2.
Services restarted and all capabilities report ready. Config SHA-256:
`49a4586f5ae1ca5064ce8d4e962b5c6512af186d2d0e34bb14f76a3ed8885f8b`.
Restore the single value to 750 to revert. This is a configuration experiment,
not a general bug-resolution claim. Actual headset rerun is pending.

### Human rerun feedback

After the requested continuous wake-plus-question rerun, the user reports
"das funktioniert nun wesentlich besser". Keep the local 1000 ms pre-roll for
continued #17 acceptance. This confirms qualitative improvement on the selected
headset, without a scored sample count or proof that every integrated question
works. Remaining general handoff/regression acceptance stays open; no source fix,
latency pass or fully validated wake claim is inferred. Effective threshold stays
0.2; the original 23/30 held-out detection result is unchanged.
