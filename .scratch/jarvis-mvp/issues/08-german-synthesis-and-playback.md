# 08: Real German synthesis and playback

**What to build:** Hear a scripted German answer synthesized locally and played on your selected output device, with actual playback and interaction-sound events.

**Blocked by:** 02: Manual activation through a scripted answer.

**Status:** ready-for-agent

- [ ] A resident CPU Piper adapter synthesizes a configured German voice, initially a provisional Thorsten medium/high choice, without network inference or dedicated inference VRAM.
- [ ] Select output using a stable device identifier through a proven PipeWire or compatible client; explicitly resample voice audio when device rates differ.
- [ ] Activation/end sounds and answer playback report actual start/completion/cancellation events rather than assuming synthesis completion means playback ended.
- [ ] Audio output and buffers are bounded; stop/error paths release pending playback without logging answer content.
- [ ] A synthetic or consented scripted answer exercises the public core-to-audio path; real model/device integration checks are separate from deterministic unit checks.
- [ ] Pin the selected voice and runtime with exact revision/checksum plus license/provenance; document supported runtime verification and missing-model errors.
- [ ] Document required local audio/runtime dependencies, voice download and checksum verification, installation, device discovery/selection, configuration, replay, stop, and troubleshooting commands; install only what this integration needs.

## Comments

Claimed for implementation on the current branch; baseline `e93d3f0`. Using the previously agreed public core and Unix-socket contract test seams.
