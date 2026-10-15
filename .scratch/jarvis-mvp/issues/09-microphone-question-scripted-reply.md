# 09: Manual microphone question and scripted spoken reply — M1

**What to build:** Activate Jarvis, speak a German question into your selected microphone, finish by silence, and hear a scripted local reply.

**Blocked by:** 06: Lock and mute privacy controls; 08: Real German synthesis and playback.

**Status:** ready-for-agent

- [x] Manual listening starts after acknowledgment, captures through PipeWire or a compatible client, and uses bounded pre-roll and explicit mono/resampling to the configured recognition format.
- [x] Resident CPU Silero VAD endpoints utterances; a replaceable CPU sherpa-onnx recognizer transcribes German and feeds the existing scripted response path.
- [x] Defaults document 16 kHz internal recognition audio, 750 ms pre-roll, illustrative 350 ms end silence, and a 30-second utterance cap without claiming calibrated accuracy.
- [x] Idle never transcribes ambient speech, and lock/mute immediately inhibits real capture and playback through the existing privacy controls.
- [x] Input/output devices use stable identifiers; missing or muted devices produce usable degraded diagnostics without silently enabling recording elsewhere.
- [x] A consented or synthetic German fixture exercises recognition, synthesis, and selected-device playback; timings are recorded without retaining/logging fixture or live conversation content.
- [x] Exact models, checksums, revisions, licensing, provenance, runtime compatibility, and recognition limitations are recorded; endpointed/chunked recognition is not presented as true partial streaming.
- [x] Document VAD/STT runtime and model installation, verification, device discovery, capture/resampling settings, fixture/demo commands, and troubleshooting; retain provisional thresholds until hardware validation.

## Comments

Claimed for implementation on the current branch; baseline `18e7c69e56449bcd70311e87c4995721b7959f23`.


## Answer

Resolved: opt-in `audio.mode: voice` now runs manual microphone questions through
native PipeWire capture, explicit mono/libsoxr 16 kHz conversion, bounded 750 ms
pre-onset audio, resident CPU Silero VAD and replaceable endpointed sherpa-onnx
Whisper tiny multilingual INT8 recognition (`language=de`). The existing core
scripted answer is synthesized by Piper and drained on the selected output.
Capture opens only after the acknowledgment completes and closes before decoding.
Default mock mode remains available. Input/output use stable identifiers; missing
or muted devices report safe diagnostics without microphone fallback. Privacy
cleanup kills the entire worker/capture process group before acknowledgment and
invalidates obsolete work. Idle does not open a microphone or invoke STT.

Exact model hashes, release asset IDs/update revisions, runtime lock hashes,
licenses and provenance are recorded. Explicit model selection rejects unsupported
IDs. See [capture setup and checks](../../../docs/audio-input.md) for installation,
verification, device discovery, provisional settings, fixture/demo commands,
diagnostics and limitations. Pre-roll in this manual-only path begins after the
cue and preserves audio before VAD onset; no pre-activation idle recording occurs.

Validation: `npm run check` passed; the full `npm test` passed **124 Node tests and
7 Python tests**. A focused red → green public adapter test proves recognition
uses the worker final transcript rather than requiring injected text. Public
core/socket coverage verifies acknowledgment ordering, absence of injected text,
scripted answer delivery, no idle transcription, and inhibition. Separate real
synthetic German fixture checks passed with the pinned models, actual selected
silent PipeWire devices, capture/resampling, VAD, final recognition, core/socket
scripted reply, Piper and playback drain. No fixture/live content was retained or
logged. Final sample: total activation-to-completion **6851 ms**, listen/endpoint
**3854 ms**, final STT **196 ms**. These are individual synthetic samples, not
calibrated acoustic latency percentiles or accuracy claims.

Review against `18e7c69`: **Standards** found no documented-standard violations and
one possible duplicated diagnostic-allowlist smell; a shared safe filter resolved
it, confirmed by re-review. **Spec** found no issues and confirmed the follow-up
model-selection/diagnostics corrections. Final findings: Standards **0**, Spec **0**.

Hardware calibration, real headset/speaker quality and mute/lock integration,
hotplug/suspend, GPU allocation measurement and German corpus accuracy remain
unvalidated. Two short synthetic questions failed exact matching; a longer fixed
question passed. Automatic microphone follow-ups, wake detection, spoken stop and
barge-in are not claimed; reactivate for each real microphone turn. The models
remain `validated: false`, and voice_conversation remains unavailable in health.

Map pointer: [implementation map](../map.md).
