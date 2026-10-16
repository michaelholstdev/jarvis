# 13: Optional validated wake activation

**What to build:** Use “Hey Jarvis” followed immediately by a question only when a verified German-capable wake model passes documented tests; otherwise retain manual activation.

**Blocked by:** 12: Login startup, KDE activation, and device recovery — M3.

**Status:** ready-for-agent

**Claimed by:** Codex (manual-only fallback; hands-free gate remains open).

## Comments

- Implementation baseline: `5e232b0204953e63a7b4edc2994442ab5d84a12c`.
  User confirmed config-loader and CLI/health test seams. No German-validated
  wake model is pinned; use the ticket's explicit manual-only fallback. Ticket
  #12 target-desktop acceptance remains open and is not bypassed by this work.

- [ ] Record model licensing, provenance, exact revision/checksum, supported ONNX runtime, and German capability before enabling wake mode; missing/unvalidated models remain disabled by default.
- [ ] Real wake detection preserves bounded pre-roll and trailing command audio, including a question spoken directly after the phrase without clipping.
- [ ] Wake acknowledgment cannot discard the immediate question, and idle still performs no STT/LLM work unless valid activation occurs.
- [ ] Measure recall, false accepts, clipping, and wake-to-listening transition timing with the actual microphone using a defined German test set and representative noise/TV/music/assistant playback.
- [ ] Publish headset and speaker results separately with model/threshold/device/settings and reproducible commands; never assume English pretrained weights establish German reliability.
- [x] Document model acquisition/verification, installation/configuration, threshold calibration, validation commands, enable/disable, and fallback troubleshooting. Current unsupported installation/enablement and future runner gaps are explicit.
- [x] This ticket does not block the manual-only release; if validation cannot pass, publish the evidence and remaining gaps, keep wake disabled, and make no hands-free acceptance claim.

## Answer

Completed the ticket's **manual-only fallback**. No German-validated model has
been selected, and no wake detector/handoff has been implemented. Wake stays
unavailable in every mode. Both config loaders now explain how to restore manual
activation when a non-null model path or threshold is supplied, without exposing
its value. The existing strict null-only schema remains the enablement barrier.

[Wake activation evidence and protocol](../../../docs/wake-activation.md) records
the upstream candidate's English-only evidence, missing artifact/runtime pins,
licensing distinction, German phrase set, proposed calibration/acceptance gates,
reproducible fallback commands and separate **unvalidated** headset/speaker
records. It explicitly lists the real detector, bounded handoff, measurement
runner and actual-microphone validation as remaining work. No hands-free claim
is made; unchecked criteria above remain open for any future wake implementation.
Ticket #12's hardware gate and M3 also remain open.

Validation: focused TypeScript and Python loader/CLI tests observed the old
diagnostics failing before the fixes and now pass. `npm run check` passes.
Full-suite and two-axis review results are recorded after completion below.

Map: [MVP implementation map](../map.md).
