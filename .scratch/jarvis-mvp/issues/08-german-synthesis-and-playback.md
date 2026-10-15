# 08: Real German synthesis and playback

**What to build:** Hear a scripted German answer synthesized locally and played on your selected output device, with actual playback and interaction-sound events.

**Blocked by:** 02: Manual activation through a scripted answer.

**Status:** ready-for-agent

- [x] A resident CPU Piper adapter synthesizes a configured German voice, initially a provisional Thorsten medium/high choice, without network inference or dedicated inference VRAM.
- [x] Select output using a stable device identifier through a proven PipeWire or compatible client; explicitly resample voice audio when device rates differ.
- [x] Activation/end sounds and answer playback report actual start/completion/cancellation events rather than assuming synthesis completion means playback ended.
- [x] Audio output and buffers are bounded; stop/error paths release pending playback without logging answer content.
- [x] A synthetic or consented scripted answer exercises the public core-to-audio path; real model/device integration checks are separate from deterministic unit checks.
- [x] Pin the selected voice and runtime with exact revision/checksum plus license/provenance; document supported runtime verification and missing-model errors.
- [x] Document required local audio/runtime dependencies, voice download and checksum verification, installation, device discovery/selection, configuration, replay, stop, and troubleshooting commands; install only what this integration needs.

## Comments

Claimed for implementation on the current branch; baseline `e93d3f0`. Using the previously agreed public core and Unix-socket contract test seams.

## Answer

Implemented optional `audio.mode: piper` with a resident CPU-only Piper 1.3.0
worker, provisional pinned German Thorsten medium voice, stable PulseAudio sink
selection and explicit libsoxr conversion from 22050 Hz to the discovered output
rate. Mock mode remains the default; recognition and inference remain scripted.
Distinct configurable activation/end tones and spoken answers wait for real
stream writes/drain before reporting completion. Stop, disconnect, error and
privacy paths destroy the worker and its bounded pending PCM; normal turns reuse
its resident model. Answers are bounded to 2048 characters and 60 seconds of PCM.

Voice and config hashes/revision, runtime artifact hashes, source/provenance and
license limitations are recorded. See [setup and replay guide](../../../docs/audio-output.md)
for installation, model verification, device selection, configuration, stop and
troubleshooting. Completed speech reports UTF-16 length; interrupted replies
conservatively report zero delivered characters pending ticket 15's alignment
work. Actual acoustic onset, headset/speaker quality, latency, GPU allocation and
hotplug/suspend remain unvalidated; the voice manifest retains validated:false.

Map pointer: [implementation map](../map.md).

Review against baseline `e93d3f0`: Standards identified a startup/privacy race and
duplicated timeout policy; Spec independently reproduced the race. Added a red →
green regression at the user-approved public output run/stop seam using delayed
real OS process creation. Privacy now waits for pending creation and destroys the
obsolete child before acknowledgment; generation checks reject stale startup.
Shared audio deadline policy keeps socket requests and core watchdogs aligned.
Both reviewers confirmed the corrections with no remaining actionable findings.

Separate real checks passed using the pinned voice on CPU and a temporary silent
48 kHz PipeWire null sink: public adapter synthesis/drain/cancel/reload and public
core-to-audio scripted answer, follow-up, manual stop and mute/unmute cleanup.
The repeatable opt-in command is `scripts/verify-output.py MODEL.onnx`; deterministic
checks do not require a model or audio session.

Final validation: `npm run check` passed (TypeScript, Biome, Ruff, mypy).
`npm test` passed: 123 Node tests and 4 Python tests. The separate pinned
Piper/PipeWire silent-sink check also passed after the review corrections.

### Follow-up review corrections

Fixed both findings from the review of `e93d3f0...60464b6`:

- Work now captures its cancellation generation synchronously at public `run`
  submission, before `create_task` can queue it. Privacy, cancel and stop invalidate
  queued work before it can spawn a worker. Stale error cleanup also cannot stop
  a newer generation.
- Scripted recognition without `text` now raises the allowlisted
  `invalid_message` diagnostic instead of an uncaught `KeyError`.

Both regressions failed before their corrections and pass afterward at the
approved public output-adapter seam. The cancellation test covers privacy,
explicit cancellation and stop, confirms no obsolete child starts, and accepts
fresh work after cleanup. The protocol test uses a schema-valid missing-text
request. Ten consecutive focused runs passed. Both independent review axes
confirmed the findings resolved with no remaining actionable concerns.

Correction validation: `npm run check` passed; `npm test` passed (123 Node tests,
6 Python tests). The separate real pinned Piper/core/socket check also passed
against the temporary silent 48 kHz PipeWire null sink.
