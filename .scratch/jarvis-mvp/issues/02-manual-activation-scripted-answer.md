# 02: Manual activation through a scripted answer

**What to build:** Activate Jarvis through the CLI, hear a simulated acknowledgment, submit a scripted utterance, and follow a complete simulated answer through playback completion.

**Blocked by:** 01: Runnable mock services and health — M0.

**Status:** ready-for-agent

- [ ] One deliberate activation starts a turn without a held key; manual listening begins only after the configurable activation sound completes.
- [ ] A scripted recognition result passes through the core to mock inference, synthesis, and playback, producing observable status and a completed reply.
- [ ] The public conversation interface is the primary behavioral test boundary; tests drive service events and a fake clock rather than private state-machine helpers.
- [ ] Idle never invokes STT or LLM for ambient audio, and all temporary work remains bounded with documented default utterance/context limits.
- [ ] Activation sounds are enabled by default and configurable; simulated playback events include the operation identity and completion/delivery information needed for later cancellation and context behavior.
- [ ] Routine logs expose status/timing/errors without fixture audio, transcript, prompt, or answer content.
- [ ] Document the exact CLI activation and scripted-demo commands, expected statuses, configuration knobs, and the distinction between mocks and real audio.
