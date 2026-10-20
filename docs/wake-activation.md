# Experimental wake activation (#13)

## Current implementation — user decision, 2026-10-20

Real `audio.mode: voice` now enables local wake detection by default, at **0.2**.
This is a user-approved experimental exception to the former validation-before-
enablement rule. Held-out headset recall was **23/30 (76.7%)**; zero false
activations cover only **240 negative seconds**. The >=95% recall target failed.
Speaker/noise/media, physical handoff/clipping, desktop privacy and release
acceptance remain open under #12/#17/#18/#19/#21. The Jieli physical mute switch
is unsupported (#24); use exposed source mute or CLI mute. No fully validated
hands-free or hardware privacy claim is made.

### Install and configure

Use Python 3.11 and the normal [voice installation](installation.md), then
explicitly install the locked optional runtime and acquire the pinned artifacts:

```sh
uv sync --frozen --python 3.11 --extra input --extra output --extra wake-benchmark
uv run --frozen python -m benchmarks.wake.prepare --download
```

Startup never downloads. The service verifies all three hashes in
[`benchmarks/wake/artifacts.json`](../benchmarks/wake/artifacts.json), classifier
filename, openWakeWord **0.6.0**, ONNX Runtime **1.31.0** on Python 3.11 (1.23.2
on the unvalidated Python 3.10 branch), and CPU-only providers before readiness.
The classifier is the official v0.5.1 `hey_jarvis_v0.1.onnx` asset **129656242**
(updated 2023-10-09), SHA-256
`94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb`.
The inventory pins mel/embedding asset IDs, hashes and dates too. Code and
feature assets use Apache-2.0; pretrained classifier terms are **CC BY-NC-SA 4.0**
(noncommercial, attribution, share-alike). This experiment does not grant
commercial/redistribution rights. Hashes are locally observed, with no independent
upstream digest; that provenance limitation remains disclosed. English training
and the German measurements below establish only the recorded experimental scope.

```yaml
wake_word:
  enabled: true                  # omission means enabled
  model_path: null               # models/wake/hey_jarvis_v0.1.onnx relative to checkout
  threshold: 0.2
```

An absolute classifier path is supported; verified mel and embedding files must
be beside it. Legacy `threshold: null` selects 0.2. Set `enabled: false` for
manual-only idle. After changing configuration, restart both services so each
reads the same setting:

```sh
systemctl --user stop jarvis-core.service jarvis-audio.service
systemctl --user start jarvis-audio.service jarvis-core.service
node dist/apps/core/main.js health
```

Stopping services cancels capture and clears worker memory; restart restores only
permitted readiness. Mock and Piper-only modes never open idle wake capture.
A missing/corrupt model, runtime or input device leaves manual fallback available
when capture is permitted. Health separates `wake_word.enabled`, operational
`wake_word.ready`, `wake_word.quality: experimental`, the configured threshold,
and `capabilities.wake`; inspect `manual_activation`, voice capabilities and
inhibitions separately. Allowlisted `audio_diagnostic` codes include
`missing_wake_model`, `wake_checksum_mismatch`, `unsupported_wake_runtime`,
`wake_runtime_unavailable` and device failures. Install locally and restart after
repair; do not change pinned hashes to hide a mismatch.

### Capture, cancellation and everyday use

Say “Hey Jarvis, [question]” as one utterance. Wake inference and subsequent
VAD/STT share one capture process, resampler and pending PCM frames. Wake uses
no acknowledgment tone, avoiding capture reset or question loss during a cue.
The detector sees 1280-sample (80 ms) signed 16-bit mono CPU frames. Before wake,
only detection runs: no ambient STT/LLM or persistent audio. A continuously
overwritten in-memory pre-roll retains at most the configured 500–1000 ms
(512-sample frames rounded down; default 736 ms). The pinned library additionally
retains bounded feature/inference state, including up to ten seconds of raw PCM
internally; this is overwritten, never archived, and reset after each capture.
Post-wake utterances are bounded by `vad.max_utterance_seconds` plus the existing
recognition completion allowance. Idle wake requests renew after at most one day;
normal operation uses a resident detector with no per-frame model loading.

Manual shortcut/`activate` remains usable: cancel the pending wake request and
clear its worker buffers, then use normal acknowledgment-before-listening.
Lock, exposed software mute, service shutdown and the owning core socket closing
kill the worker process group, including its capture child. Privacy barriers
invalidate old operation IDs and erase temporary audio/context. Clearing one
inhibition cannot override another. Recovery arms a fresh permitted idle detector;
it never replays a canceled question or answer. Use `start-desktop`/installed units
for KDE lock/source monitoring; plain `start` has only explicit CLI inhibitions.
Physical cancellation latency still requires hardware measurement.

Keep a content-free daily tally: setup/config/model identity, intended wake
attempts, observed misses, unintended activations, duration, and condition
(headset/quiet/noise/media). Count the `wake_detected` timing events for observed
activations; classify false activations yourself. Misses cannot be inferred from
detector logs alone. Record counts and onset-clipping yes/no, never ambient
recordings, transcripts, question text or routine diagnostic audio. Use manual
activation after a miss. If a concrete failure recurs, attach its counts and
setup to #13; change calibration/model only on development data and repeat fresh
held-out validation. Existing calibration and validation files remain separate.
Deliberate consented recording/evaluation below is optional evidence collection,
not routine operation. No new physical acceptance was performed for this change.

Socket/fixture tests exercise continuous marked PCM, overwritten bounded pre-roll,
manual interaction, independent inhibitions, disconnect cancellation, fresh
readiness and stale-event rejection. They establish software behavior only.

## Historical candidate evidence and original full-validation gate

The following dated investigations describe the earlier default-disabled stage.
Their original >=95% recall, false-activation, clipping and privacy acceptance
criteria remain the full-validation gate. They do not override the experimental
configuration above.

## Evidence and model gate

The proposed upstream candidate is openWakeWord's pretrained `hey_jarvis`.
The [upstream README](https://github.com/dscripka/openWakeWord#pre-trained-models)
describes English-only support. Its
[license section](https://github.com/dscripka/openWakeWord#license) distinguishes
Apache-2.0 code from CC BY-NC-SA 4.0 pretrained weights. The
[model card](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md)
describes synthetic training, an American-English test speaker, and recommends
a pause after the phrase. These are insufficient evidence for German wake plus
an immediate question. This assessment concerns this candidate; it is not a claim
that no German-capable model can exist. Sources were inspected on the decision
date; links to `main` are evidence references, not artifact revision pins.

| Required evidence | Current record |
| --- | --- |
| Model artifact, original source, license/terms, training provenance | Official v0.5.1 candidate acquired for offline screening; not approved for activation |
| Exact artifact revision and independently verified SHA-256 | Asset IDs/update times and observed hashes in `benchmarks/wake/artifacts.json`; upstream supplies no independent digest; no production wake manifest entry |
| Feature extractor/embedding/verifier artifacts and their licenses/checksums | Mel and embedding artifacts acquired and hash-pinned for screening; verifier is integrated in classifier; independent checksums remain missing |
| Supported ONNX runtime/provider and complete dependency lock | Offline CPU probe passes with openWakeWord 0.6.0 / ONNX Runtime 1.31.0 on Python 3.11; optional dependencies locked |
| German capability and calibrated threshold | Unvalidated; English evidence cannot establish it |
| Bounded pre-roll, immediate trailing command, acknowledgment safety | Wake handoff not implemented or tested |
| Target microphone measurements | Not performed |

Acquiring a future candidate must use an immutable upstream revision and explicit
artifact URLs. Review the model card and terms, record every artifact (including
feature/embedding models) in the manifest, and compare `sha256sum <artifact>`
against independently supplied expected checksums. A locally computed digest
alone establishes identity, not trusted provenance. Record exact CPU ONNX
runtime version/provider, engine version and lockfile, sample format and model
input/output requirements; run an offline load/inference compatibility check.
There is no approved production wake installation command in this release.
Setting a manifest `validated` flag cannot enable wake detection.

## Offline candidate evaluation — 2026-10-20

`benchmarks/wake` implements the first feasibility step of #13. It downloads only
when explicitly requested, checks pinned artifact hashes before inference, runs
the real three-model pipeline on CPU, and streams consented 16 kHz mono signed
16-bit WAV files in 80 ms frames. There is no microphone access in the evaluator,
ambient transcription, LLM call or service configuration change. Model binaries
and generated audio stay under ignored `models/`.

```sh
uv sync --frozen --extra wake-benchmark --extra output --extra input
uv run --frozen python -m benchmarks.wake.prepare --download
uv run --frozen python -m benchmarks.wake.prepare --corpus models/wake/corpus
uv run --frozen python -m benchmarks.wake.evaluate \
  --corpus models/wake/corpus/manifest.json --models models/wake \
  --threshold 0.5 --output benchmarks/wake/synthetic-quiet.json
```

The generator uses the existing hash-verified Thorsten voice and ten German
immediate-question phrases at three speaking rates. Negatives contain the same
questions without a wake phrase and with “Hey Jasper” / “Hey Travis”. This is one
synthetic speaker, not independent human acoustic evidence. It deliberately uses
a generous whole-speech detection window; it cannot establish wake timing,
command onset preservation or clipping. The optional runtime was exercised on
Linux x86-64 / Python 3.11. The Python 3.10 dependency branch pins ONNX Runtime
1.23.2 but is untested; upstream's mandatory TFLite wheel dependency may prevent
installation on newer Python versions despite using ONNX here. Use Python 3.11
for this experiment. Production speech dependencies remain available separately.

At threshold **0.5**, the [real inference report](../benchmarks/wake/synthetic-quiet.json)
records **0/30** positive detections and **9 false activations** over 90 negative
clips (380.66 seconds). The [exploratory 0.01 run](../benchmarks/wake/calibration-low-threshold.json)
uses the same corpus for calibration, so it is not a held-out result. Lowering
the threshold must be judged against near misses, not recall alone. Neither run
passes the screen; neither proves this candidate cannot work for a human speaker.
There is no approved threshold or German-capable production candidate yet.

Reports contain trial IDs, hashes, durations, scores, counts, audio-relative
detection timestamps, runtime/provider and dependency-lock identity. They omit
transcripts, raw audio and file paths. Invalid input replaces previous output with
an incomplete failed report; truncated WAVs, duplicate trial IDs and interrupted
recording manifests are rejected. Exit 0 means measurements completed, **not**
screen or acoustic acceptance. Exit 2 means invalid input or failed evaluation.
The preliminary screen requires at least 30 positive and 30 negative clips in
each supplied condition, recall >=95% and zero false activations. Physical
acceptance always remains false in this detector-only tool; production handoff
latency and clipping are null, not invented zeroes.

To evaluate existing consented recordings, provide a JSON object with `trials`:

```json
{"trials": [{"id": "positive-01", "condition": "headset-quiet",
  "intended_wake": true, "path": "positive-01.wav", "sha256": "<WAV SHA-256>",
  "wake_window_ms": [1000, 3000]}]}
```

Paths are relative to the manifest. Label a detection window for each intentional
wake; negative trials omit `wake_window_ms`. One intended wake permits one
detection; extras count as false activations, with a two-second refractory period.
Annotate windows independently from detector scores. Keep calibration recordings
separate from held-out acceptance recordings, and do not combine headset and
speaker verdicts.

### Prepared headset calibration session

The user requested this preparation on 2026-10-20; **no physical recording has
been started by the agent**. List available sources with
`pactl --format=json list sources`, select the headset's stable physical source
name, and run from a terminal in the checkout:

```sh
uv run --frozen python -m benchmarks.wake.record \
  --source '<stable physical headset source name>' \
  --directory models/wake/headset-calibration-01
```

The directory must be new and is created private to the user. The recorder shows
each phrase and waits for Enter before opening capture. Speak one second after
“RECORDING”; each clip lasts eight seconds and capture then stops. It collects
ten positive immediate questions and ten near misses. Ctrl-C stops the session;
partial sessions are marked incomplete. These 20 clips are for calibration and
cannot satisfy the 30-trial screen or the complete acoustic protocol below.

The recorder checks the selected source, software mute, KDE lock and logind sleep
state before capture, periodically during capture, and before saving. Unknown or
inhibited state aborts and discards the current clip. This polling experiment is
not a measured production privacy-latency pass. The Jieli hardware switch remains
unsupported; use the exposed software mute control. No service is started or
reconfigured. Recordings remain in the chosen directory until you delete them;
share only the generated reports for review.

After recording, evaluate `models/wake/headset-calibration-01/manifest.json` with
the evaluator command above and a separate report path under `models/wake/`.
Compare thresholds on calibration data, freeze one, then collect fresh held-out
trials using the acceptance protocol. A promising human candidate still needs
bounded resident pre-roll, continuous handoff, privacy/cancellation socket tests,
and separate physical acceptance before service enablement.

## Configuration and fallback troubleshooting

Use the current installation/configuration section above. `enabled: false`
disables idle wake capture; `activate` remains the manual shortcut/CLI fallback.
The historical null-only schema restriction has been removed. Inspect health
and content-free audio diagnostic codes before repeating an activation.

## Defined future German microphone acceptance protocol

This is a protocol for a future implemented candidate. It cannot currently be run
end to end: the detector, handoff, content-free timing instrumentation and
validation runner are remaining implementation work. Do not substitute the
manual `activate` command or synthetic events for a wake detection result.

Use these ten exact phrases without a deliberate pause after “Jarvis”:

1. Hey Jarvis, wie spät ist es?
2. Hey Jarvis, erkläre mir den Unterschied zwischen RAM und VRAM.
3. Hey Jarvis, was bedeutet CPU auf Deutsch?
4. Hey Jarvis, wie funktioniert PipeWire?
5. Hey Jarvis, nenne drei Vorteile von Linux.
6. Hey Jarvis, was ist ein Git Commit?
7. Hey Jarvis, erkläre mir einen HTTP Timeout.
8. Hey Jarvis, wie berechnet man sieben mal acht?
9. Hey Jarvis, was bedeutet Stopp auf Englisch?
10. Hey Jarvis, warum ist der Himmel blau?

For each setup, speak the set three times at ordinary pace and volume, recording
30 trials for each of quiet, representative room noise, TV speech and music.
Document speaker language/accent, microphone stable ID, sink, distance,
input/output gain, room, playback material/level, sample rate, pre-roll, threshold,
model hashes and all software versions. Repeat separately with a headset and
speakers, including representative assistant playback as a false-accept source.
No automatic ambient STT is allowed to collect labels. Use consented controlled
test audio only if needed to judge clipping; keep it outside routine logs and
delete it after review. Routine evidence records trial IDs, counts and timing.

Calibrate thresholds on a separate practice set, freeze the selected value and
settings, then run the above held-out trials. Any threshold/device/model change
invalidates the result and requires a new run. Proposed local acceptance gates
(policy targets, not measured performance): recall at least 95% in **each**
condition, zero clipped commands among detected trials, wake-detection to capture
handoff p95 at most 100 ms, and zero false accepts during a two-hour negative
run per setup. Split that run equally across room noise, TV, music and assistant
playback without an intentional user wake. Include near-misses such as “Hey
Jasper” and ordinary German speech. Count media/assistant activations as false
accepts, even if playback contains the phrase. Report the observed rate and
duration; zero events over two hours is not a universal reliability guarantee.

Recall = detected intended wakes / attempted wakes. Report missed wakes
separately from command clipping. Clipping = detected trials missing any initial
or trailing command audio / detected trials; zero detections makes clipping and
latency undefined, not zero. Timestamp detection and the start of the handoff
with one monotonic clock; publish p50/p95/max and trial counts. Also compare
command onset to the oldest retained sample to expose late detection. A bounded
500–1000 ms overwritten pre-roll must retain command onset, and subsequent audio
must continue through acknowledgment and endpointing without a capture gap.
Acknowledgment must not reset capture or mask the immediate question.

The future runner must publish exact invocation commands, exit status, config
and model identity with the result. It must also verify idle never requests
STT/LLM without valid activation, lock/mute clears all wake buffers and prevents
capture, and readiness recovery never replays audio. Do not enable wake in a
release until those checks and the acoustic gate pass for the claimed setup.

## Results and remaining gaps

| Setup | Model / threshold / device / settings | Recall | False accepts / duration | Clipping | Handoff latency | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Headset | No selected model; threshold null; target device/settings unrecorded | Unvalidated | Unvalidated | Unvalidated | Unvalidated | Disabled |
| Speakers | No selected model; threshold null; target device/settings unrecorded | Unvalidated | Unvalidated | Unvalidated | Unvalidated | Disabled |

No actual-microphone wake measurements were made. Remaining work is model
acquisition/provenance/runtime verification, a real detector and bounded audio
handoff, acknowledgment-safe command preservation, calibration/measurement tools,
and both target-device runs. The missing model gate prevents a meaningful wake
trial; no recall, false-accept, clipping or timing numbers are invented. Manual
activation remains the release path; hands-free acceptance and M3 remain open.

## Release feasibility revisit — 2026-10-19

For #19, rechecked the [upstream language/support and license sections](https://github.com/dscripka/openWakeWord#language-support)
and [Hey Jarvis model card](https://github.com/dscripka/openWakeWord/blob/main/docs/models/hey_jarvis.md).
The published support remains English; the card's pause recommendation and
American-English test speaker do not demonstrate immediate German command
retention. Code/weights terms remain distinct (Apache-2.0 / CC BY-NC-SA 4.0).
This is a source-level feasibility review, **not** a failed German recall trial
and not proof that a German candidate cannot work.

Also inspected the [German training entry](https://openwakeword.com/de),
[community library](https://openwakeword.com/library) and
[benchmark entry](https://openwakeword.com/benchmarks). The retrieved pages
advertise multilingual custom ONNX training; their accessible text supplies no
specific German Hey Jarvis artifact with immutable revision, expected checksum,
model-specific terms or target-microphone results. The interactive library is a
JavaScript app; its model inventory was not evaluated in this source retrieval.
Do not treat a training-service claim as a selected, licensed, validated model.
No model was trained, downloaded, pinned or run during this revisit.

Outcome: no candidate has **passed the project's artifact/runtime/German gate**;
actual model feasibility remains incomplete. Manual physical operation itself is
not yet accepted, so the planned after-stable-operation investigation still
applies. Follow-up remains [ticket #13](../.scratch/jarvis-mvp/issues/13-optional-validated-wake-activation.md):
inspect the interactive German library or a reproducible local training route,
select/pin a candidate and feature artifacts with terms/provenance, lock and test
CPU runtime compatibility, then evaluate consented German immediate-command
recordings before judging it promising. If promising, implement detector,
bounded pre-roll/handoff and timing runner, then run the separate headset and
speaker acceptance protocol above. Missing recordings, artifact pins, runtime
probe and handoff remain concrete gaps. Wake stays disabled, #13 stays open;
repeat this investigation before final hardware acceptance rather than silently
closing #13 for the manual fallback.
