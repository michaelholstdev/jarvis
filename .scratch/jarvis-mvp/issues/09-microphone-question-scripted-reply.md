# 09: Manual microphone question and scripted spoken reply — M1

**What to build:** Activate Jarvis, speak a German question into your selected microphone, finish by silence, and hear a scripted local reply.

**Blocked by:** 06: Lock and mute privacy controls; 08: Real German synthesis and playback.

**Status:** ready-for-agent

- [ ] Manual listening starts after acknowledgment, captures through PipeWire or a compatible client, and uses bounded pre-roll and explicit mono/resampling to the configured recognition format.
- [ ] Resident CPU Silero VAD endpoints utterances; a replaceable CPU sherpa-onnx recognizer transcribes German and feeds the existing scripted response path.
- [ ] Defaults document 16 kHz internal recognition audio, 750 ms pre-roll, illustrative 350 ms end silence, and a 30-second utterance cap without claiming calibrated accuracy.
- [ ] Idle never transcribes ambient speech, and lock/mute immediately inhibits real capture and playback through the existing privacy controls.
- [ ] Input/output devices use stable identifiers; missing or muted devices produce usable degraded diagnostics without silently enabling recording elsewhere.
- [ ] A consented or synthetic German fixture exercises recognition, synthesis, and selected-device playback; timings are recorded without retaining/logging fixture or live conversation content.
- [ ] Exact models, checksums, revisions, licensing, provenance, runtime compatibility, and recognition limitations are recorded; endpointed/chunked recognition is not presented as true partial streaming.
- [ ] Document VAD/STT runtime and model installation, verification, device discovery, capture/resampling settings, fixture/demo commands, and troubleshooting; retain provisional thresholds until hardware validation.
