# 02: Manual activation through a scripted answer

**What to build:** Activate Jarvis through the CLI, hear a simulated acknowledgment, submit a scripted utterance, and follow a complete simulated answer through playback completion.

**Blocked by:** 01: Runnable mock services and health — M0.

**Status:** ready-for-agent

- [x] One deliberate activation starts a turn without a held key; manual listening begins only after the configurable activation sound completes.
- [x] A scripted recognition result passes through the core to mock inference, synthesis, and playback, producing observable status and a completed reply.
- [x] The public conversation interface is the primary behavioral test boundary; tests drive service events and a fake clock rather than private state-machine helpers.
- [x] Idle never invokes STT or LLM for ambient audio, and all temporary work remains bounded with documented default utterance/context limits.
- [x] Activation sounds are enabled by default and configurable; simulated playback events include the operation identity and completion/delivery information needed for later cancellation and context behavior.
- [x] Routine logs expose status/timing/errors without fixture audio, transcript, prompt, or answer content.
- [x] Document the exact CLI activation and scripted-demo commands, expected statuses, configuration knobs, and the distinction between mocks and real audio.

## Comments

Implemented on the current branch: public fake-clock conversation flow, scripted
CLI activation/demo, mock Python recognition/synthesis/playback, operation IDs
and simulated delivery reports, bounded work and temporary reply access, and
content-free status/timing/error output. Real audio remains unvalidated.

Validation: `npm run check` and `npm test` passed (10 Node, 3 Python tests).
Standards review: no remaining findings. Spec review: no remaining findings.

### Review corrections

Resolved the subsequent review findings: lone-surrogate audio requests return
`invalid_message`, every handler exit releases connection capacity, compact
UTF-8 responses preserve German scripts within the configured byte/frame
limits, and readiness age is separate from conversation-state/watchdog timing.
Aligned the delivery-count schema with supported supplementary Unicode text.

Regression checks cover repeated malformed requests followed by healthy
service use, a full-budget German CLI script, supplementary-character delivery
with larger configured frames, and readiness timing across activation,
watchdog expiry and service transitions. `npm run check` and `npm test` pass
(12 Node tests, 3 Python tests). Standards and spec re-review found no remaining
findings.
