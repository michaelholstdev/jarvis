# Headset wake held-out validation — 2026-10-20

The user completed three fresh sessions (02, 03, 04), each with ten intentional
wake trials and ten near-miss negatives. Threshold **0.2** was fixed before
collection and was the only threshold evaluated on these held-out recordings.
Model artifacts and CPU runtime are those pinned by `benchmarks/wake/artifacts.json`
and the evaluation report. Sources match across the session manifests; unchanged
microphone gain/distance were instructed but are not independently recorded.

All three recording manifests are complete. The evaluator verified every WAV
checksum, format and duration. All 60 audio hashes are distinct, with no overlap
with the original calibration set. Source trial IDs were prefixed by session
when combining the manifests; the combined condition is `headset-quiet-held-out`.
Raw WAVs remain local under ignored `models/` and are not included in this report.

| Session | Wake detections | Negative clips triggered | False activations |
| --- | --- | --- | --- |
| 02 | 10/10 | 0/10 | 0 |
| 03 | 6/10 | 0/10 | 0 |
| 04 | 7/10 | 0/10 | 0 |
| Total | **23/30 (76.7%)** | **0/30** | **0 over 240 negative seconds** |

**Screen failed:** recall is below the documented >=95% target (at least 29/30).
The initially promising 10/10 calibration did not generalize to these fresh
recordings. The threshold was not changed after inspecting this result. This
short negative set does not establish the two-hour acoustic false-accept gate.

The seven misses have RMS levels between -27.5 and -24.6 dBFS and zero full-scale
samples. Detected positives overlap that level range. These level observations
do not identify an obvious silence/overload explanation; they do not establish
speech content, pronunciation or precise wake/command boundaries. No transcription
or new physical recording occurred during evaluation.

Combined corpus SHA-256: `5f0093cb3a932d627dd37bcd7e4999e050109f5d8fb3e7baba59017f952c7c69`.
Runtime: openWakeWord 0.6.0, ONNX Runtime
1.31.0, CPUExecutionProvider. Detailed reports:
`models/wake/headset-validation/threshold-0.2.json` and `signal-quality.json`.

Production wake remains unavailable. #13 stays open. The next candidate/model
investigation may reuse these recordings as development data, but these files
must then cease to count as held-out evidence for that changed candidate. A new
candidate needs separate fresh held-out validation, plus the remaining physical
noise/media, pre-roll/handoff and privacy/cancellation gates before enablement.
