# 20: Production Parakeet recognition

**Type:** Implementation

**Status:** ready-for-agent

**Claimed by:** Codex

**Resolution:** Implemented; human acceptance is tracked by #17.

**Blocked by:** None; #16 comparison and recognizer boundary are delivered.

**What to build:** Make the Parakeet TDT v3 INT8 CPU candidate recommended by #16
selectable in the running audio service, through the existing recognizer boundary.
This is the next agent implementation ticket. No acoustic validation is implied.

## Acceptance criteria

- [x] Inspect the existing recognizer/configuration seams and integrate Parakeet
  without adding a second conversation-control path. Endpointed recognition must
  not be described as true partial streaming.
- [x] Expose an explicit validated recognizer selection and required model paths;
  preserve mock operation and document Whisper compatibility/migration. CPU is
  the default; no speech GPU allocation, cloud fallback or inference-time download.
- [x] Reuse #16's pinned artifacts/runtime and verification where appropriate;
  document licenses, hashes, acquisition, installation and offline loading.
  Missing/invalid artifacts produce content-free degraded capability diagnostics,
  with no silent recognizer substitution.
- [x] Preserve bounded utterances/work, cancellation, privacy cleanup, deterministic
  voice control phrases, follow-up deadlines and stale-result rejection.
- [x] Exercise recognition through the real service path with a reproducible
  synthetic German fixture; verify selection/error behavior and cancellation/
  privacy at the existing public seams. Run appropriate checks and full regressions.
- [x] Publish commands, configuration and measured CPU/RAM/latency observations;
  update input/configuration/installation and release evidence docs. Do not replace
  old Whisper evidence or mark physical German accuracy/latency passed.
- [x] Hand the reproducible production setup to #17 for human headset quality,
  model selection and timing; track failures as focused bug tickets.

## References

- [Comparison and pinned model evidence](../../../docs/recognition-comparison.md)
- [Audio input](../../../docs/audio-input.md)
- [Architecture](../../../docs/ADR-0001-architecture.md)
- [Map and next-work order](../map.md)

## Answer

Production Parakeet TDT v3 INT8 is selectable as `parakeet-tdt-v3-int8` through
schema-validated configuration and the existing resident CPU input boundary.
Selected model hashes plus Silero are checked before capture. Whisper compatibility
and mock defaults remain; no fallback, GPU provider or inference download was added.

[Production installation, evidence and #17 handoff](../../../docs/parakeet-production.md)
include pinned acquisition, licensing, required paths and synthetic service checks.
[Raw production report](../../../benchmarks/recognition/production-parakeet.json)
records exact synthetic German recognition, core/socket/capture/playback, live-speech
cancel/privacy barriers, stale work and missing/corrupt artifact rejection. CPU/RAM
and single-run timings are scoped observations, not physical acceptance. Existing
voice-control/deadline logic and historical Whisper reports remain unchanged.

#17 can now start human headset quality/model selection and latency acceptance with
this reproducible setup. Human accuracy/latency, voice stop and desktop gates remain
unvalidated. Any observed human-trial failure needs a focused bug ticket.

Map: [#20 production integration](../map.md).

## Comments

2026-10-19: Split production integration from completed comparison #16. Production
Whisper failed the synthetic quality screen; Parakeet passed only that screen.


Validation: `npm run check` passes; full `npm test` passes **204 Node / 42 Python**.
Focused schema and artifact tests were observed red before implementation. The
real synthetic service check passes with provenance/resource report. Both final
code-review axes report **0 remaining findings**; shared endpoint decoding resolves
the Standards duplication observation. No acoustic acceptance is claimed.
