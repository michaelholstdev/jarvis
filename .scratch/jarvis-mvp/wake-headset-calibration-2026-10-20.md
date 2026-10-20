# Headset wake calibration — 2026-10-20

20 completed physical headset recordings: 10 intentional wakes, 10 near-miss negatives.
All WAVs passed manifest checksum, format and duration validation.
No transcription, new capture or service configuration change was performed during evaluation.

| Threshold | Intended wakes detected | Negative clips triggered | False activations |
| --- | --- | --- | --- |
| 0.01 | 10/10 | 3/10 | 3 |
| 0.05 | 10/10 | 0/10 | 0 |
| 0.1 | 10/10 | 0/10 | 0 |
| 0.2 | 10/10 | 0/10 | 0 |
| 0.3 | 10/10 | 0/10 | 0 |
| 0.5 | 6/10 | 0/10 | 0 |
| 0.7 | 5/10 | 0/10 | 0 |
| 0.9 | 4/10 | 0/10 | 0 |

Corpus SHA-256: `abc9438ee9be99b749d13ab627c17a41e9d2b380f31a5118e2f10d6b4c62f0f1`.

Provisional calibration candidate: **0.2**. Positive peak scores range from 0.367235 to 0.998610; highest negative peak is 0.039025. Threshold selection used these same recordings, so the result is not held-out validation. The negative audio totals only 80 seconds.

One positive clip contains 31 full-scale samples out of 128000; this is a small waveform saturation observation, not a command-preservation/clipping verdict. No audio intelligibility or precise wake/command boundary was assessed.

Next: freeze the model/threshold/device/gain settings and collect new held-out positives and negatives. The documented screen needs >=30 of each per supplied condition; the physical protocol additionally requires noise/media conditions, false-accept duration, continuous handoff and privacy/cancellation evidence. Production wake remains unavailable; #13 remains open.

Detailed content-free per-threshold reports and the original local recordings remain under ignored `models/wake/headset-calibration-01/`; no raw audio is copied into the tracker.
