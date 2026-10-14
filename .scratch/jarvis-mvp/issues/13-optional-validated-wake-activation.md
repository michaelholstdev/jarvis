# 13: Optional validated wake activation

**What to build:** Use “Hey Jarvis” followed immediately by a question only when a verified German-capable wake model passes documented tests; otherwise retain manual activation.

**Blocked by:** 12: Login startup, KDE activation, and device recovery — M3.

**Status:** ready-for-agent

- [ ] Record model licensing, provenance, exact revision/checksum, supported ONNX runtime, and German capability before enabling wake mode; missing/unvalidated models remain disabled by default.
- [ ] Real wake detection preserves bounded pre-roll and trailing command audio, including a question spoken directly after the phrase without clipping.
- [ ] Wake acknowledgment cannot discard the immediate question, and idle still performs no STT/LLM work unless valid activation occurs.
- [ ] Measure recall, false accepts, clipping, and wake-to-listening transition timing with the actual microphone using a defined German test set and representative noise/TV/music/assistant playback.
- [ ] Publish headset and speaker results separately with model/threshold/device/settings and reproducible commands; never assume English pretrained weights establish German reliability.
- [ ] Document model acquisition/verification, installation/configuration, threshold calibration, validation commands, enable/disable, and fallback troubleshooting.
- [ ] This ticket does not block the manual-only release; if validation cannot pass, publish the evidence and remaining gaps, keep wake disabled, and make no hands-free acceptance claim.
