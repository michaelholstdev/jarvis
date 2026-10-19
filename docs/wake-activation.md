# Optional wake activation: manual-only decision (#13)

Decision recorded 2026-10-16: **wake unavailable; manual activation retained**.
This is the fallback allowed by ticket #13, not a hands-free implementation or
acceptance pass. No wake detector, idle microphone loop, wake acknowledgment,
prefix splitter, or wake-to-recognizer audio handoff is implemented. Ticket #12's
target KDE/device acceptance also remains open. Manual operation setup is in
[desktop acceptance](desktop-acceptance.md) and [microphone input](audio-input.md).

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
| Model artifact, original source, license/terms, training provenance | Candidate above only; no artifact acquired or approved |
| Exact artifact revision and independently verified SHA-256 | Missing; no wake entry in `config/models.json` |
| Feature extractor/embedding/verifier artifacts and their licenses/checksums | Not acquired or verified |
| Supported ONNX runtime/provider and complete dependency lock | Not selected or tested; no wake engine in `pyproject.toml`/`uv.lock` |
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
There is no approved model download or wake installation command in this release.
Setting a manifest `validated` flag cannot enable wake detection.

## Configuration and fallback troubleshooting

Keep these settings, or omit the entire group to use their defaults:

```yaml
wake_word:
  phrase: Hey Jarvis
  model_path: null
  threshold: null
```

Both services reject any non-null model path or threshold before starting. They
explain how to restore manual activation without echoing the configured value.
An invalid wake setting stops startup; it is not silently ignored. Restore both
values to null and restart the services using the desktop guide. There is no
supported wake enable switch or threshold calibration setting yet. Copying an
English ONNX file into `models/` does not change this. Wake remains disabled in
mock, Piper, and voice modes.

From the checkout, after the normal locked installation:

```sh
npm run build
node dist/apps/core/main.js config
node --test dist/tests/config.test.js dist/tests/core.test.js dist/tests/recovery.test.js
uv run --frozen python -m unittest tests.config_test
# With audio/core running in the user's private runtime directory:
node dist/apps/core/main.js health
node dist/apps/core/main.js activate
```

Health reports `capabilities.wake: unavailable`. `manual_activation: ready`
requires real speech capabilities and cleared privacy/device barriers; `mock`
only establishes the scripted path. Missing STT/TTS/Ollama is a separate voice
readiness problem: follow the input/output/Ollama setup guides. Manual activation
listens after its acknowledgment. In manual-only idle there is no ambient
capture, pre-roll, STT, or LLM work. These automated checks establish fallback
behavior, not acoustic performance.

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
