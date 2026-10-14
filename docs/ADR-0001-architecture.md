# ADR-0001: Architecture of the local Jarvis voice assistant

- **Status:** Accepted for MVP; model selections provisional pending hardware benchmarks
- **Date:** 2026-10-14
- **Owners:** Project maintainers
- **Related:** [PRD](./PRD-jarvis.md)
- **Terminology:** [Glossary](../GLOSSARY.md)
- **Design baseline:** Product decisions confirmed in the 2026-10-14 design interview; hardware validation remains open

## Context

Jarvis is a German-first, privacy-oriented voice assistant operating as a background service on CachyOS (Linux, KDE Plasma, PipeWire). Target hardware: AMD Radeon RX 9070 XT (16 GB VRAM), Ryzen 5 5600, 32 GB RAM. The assistant wakes on “Hey Jarvis,” accepts a command in the same utterance, maintains conversational context for follow-up questions without repeating the wake word, supports explicit/session-timeout termination, and should progressively support interruption of speech output. STT, TTS, wake-word detection, and LLM inference must be local. Optional tools can access the internet only when explicitly enabled, e.g. for current stock market prices.

The key constraint is to **preserve GPU VRAM for Ollama** and keep the speech stack on the CPU by default. Minimize latency without sacrificing reliability or making unsupported claims about model performance on this hardware.

The first release targets offline German conversational questions and follow-ups on the user's CachyOS desktop, primarily with a headset. Broad Linux support and current-data integrations are deferred. Manual activation is an accepted MVP release mode; hands-free activation has its own validation gate. Publish headset and speaker results separately.

## Decision

### 1. Deployment and process boundaries

Use three independent processes, with only the two Jarvis processes owned by this project:

1. **`jarvis-core`**: Node.js + TypeScript. Deterministic state machine, conversation/session manager, LLM gateway (Ollama), tool registry, policy checks, cancellation, configuration, observability.
2. **`jarvis-audio`**: Python service. PipeWire-compatible audio capture/output, mono PCM conversion, ring buffer, wake-word detection, voice activity detection (VAD), speech-to-text (STT), text-to-speech (TTS), playback events. Keep selected models resident in memory.
3. **Ollama**: independently managed local inference service on loopback, with a configurable model and generation settings. No cloud fallback.

Use a **Unix-domain socket** for bidirectional JSON control messages and binary/audio frames or a separately negotiated local audio channel. Prefer a versioned, documented protocol over ad hoc CLI subprocess calls on each request. Prevent unbounded queues; support backpressure and cancellation. No public listener by default. Only `jarvis-core` is permitted to trigger tools.

Run Jarvis using **systemd user services** after the user's audio session is available; do not run as root. Disable linger by default: always-on means while the user is logged in, not capturing audio outside that session. A separate optional tray UI must not be required for operation.

Desktop lock and mute disable microphone capture, stop playback, cancel recognition/generation, and close the conversation. Clear temporary audio and context. Unlocking or unmuting restores activation readiness without resuming canceled work; a remaining lock or mute continues to block capture.

### 2. Audio and speech engines

| Function | Initial implementation | Rationale / fallback |
|---|---|---|
| Capture/playback | PipeWire via a proven client/library (or PulseAudio-compatible PipeWire client), device selection by stable ID | Avoid hard-coded device names; recover after hotplug or suspend/resume |
| Wake word | `openWakeWord` with a **verified German-capable “Hey Jarvis” ONNX model** | Do not assume an English pretrained model recognizes German reliably; provide manual activation fallback until validation |
| VAD | Silero VAD CPU | Gate STT, determine end-of-utterance; tune thresholds on actual microphone |
| STT | `sherpa-onnx` on CPU; benchmark German-capable Parakeet TDT v3 INT8 against a small true-streaming model | Parakeet chunked/endpointed recognition is not necessarily genuine partial streaming; use interface `StreamingRecognizer` to permit replacement |
| TTS | Piper German voice (start with Thorsten medium/high), ONNX CPU | Use persistent model; exploit audio-chunk API, sentence-level generation |
| LLM | Ollama on the RX 9070 XT, selectable model | Streaming responses; keep only necessary conversation history; local-only inference |
| Acoustic echo cancellation | PipeWire's WebRTC-based echo cancellation, opt-in/configurable | Essential for speaker-based barge-in; verify effectiveness with real devices |

**MVP rule:** The assistant can ship with endpointed STT, half-duplex conversation, and manual activation. Spoken “Stopp” during playback is a separate P0 capability requiring bounded microphone processing and independent acoustic tests; half-duplex conversation must not be used to claim this capability works without evidence. Manual cancellation remains available when voice stop is unreliable, and FR-09 then remains a documented gap. General full-duplex barge-in is P1 and must pass acoustic tests before being enabled by default. Never confuse VAD activity with confirmation that the human interrupted the assistant.

Manual activation uses a single shortcut press or CLI trigger; silence endpoints the utterance without holding a key. Configurable activation and distinct conversation-end sounds are enabled by default. Manual listening begins after the activation sound finishes. Wake activation preserves immediate trailing speech despite any acknowledgment sound.

### 3. Session state machine

States (single active user/session in MVP):

- `IDLE`: while unlocked and unmuted, process configured wake detection and bounded, continuously overwritten in-memory pre-roll; STT/LLM are not invoked for ambient audio. Manual-only mode awaits deliberate activation.
- `LISTENING`: record utterance, using VAD and a 500–1000 ms rolling pre-roll. Accept command spoken directly after wake phrase. Detect silence, max utterance length, errors.
- `THINKING`: send finalized transcript and current context to LLM; tools are subject to permissions; cancellable.
- `SPEAKING`: play the reply, with independently validated voice stop and manual cancellation. General full-duplex user interruption is enabled only after filtering playback echo and passing acoustic tests; early speech from LLM output remains P1.
- `FOLLOW_UP`: following playback completion or stop playback, listen for another user utterance without wake word for a default **20-second** window. Speech detection permits bounded recognition completion; empty/noise recognition does not renew the original deadline.
- `AWAITING_EXTENSION`: after the duration allowance expires and the current turn finishes, play a brief extension prompt, then accept only explicit extension/end commands for 20 seconds. “Weiter” renews the allowance by five minutes with existing context; silence closes the conversation.

Lock and mute are capture-inhibiting conditions, distinct from `IDLE`, and take precedence over all conversation states.

Transitions:

- `IDLE` + valid wake phrase → `LISTENING` (include pre-roll and trailing speech; never discard the command following wake phrase).
- `IDLE` or `FOLLOW_UP` + manual activation → `LISTENING` after acknowledgment, provided capture is not inhibited by lock or mute.
- `LISTENING` + endpoint/transcript → `THINKING`; silence/no speech → `FOLLOW_UP` or `IDLE` depending on session.
- `THINKING` + answer → `SPEAKING`; cancel/error → safe recovery / `FOLLOW_UP`.
- `SPEAKING` + playback ended → `FOLLOW_UP` (timer starts **now**, not at transcript time).
- `SPEAKING` + standalone “Stopp” → cancel current reply, retain delivered reply, `FOLLOW_UP`; the window starts when playback stops.
- `THINKING` or `SPEAKING` + manual activation → cancel current operation, `LISTENING` after the activation sound; discard an unanswered canceled question and any undelivered reply remainder, retaining earlier completed exchanges and any delivered reply.
- `SPEAKING` + validated barge-in → cancel TTS/LLM generation; `LISTENING`.
- `FOLLOW_UP` + detected user speech → `LISTENING`; timeout/explicit end command → `IDLE`.
- Any active state + explicit end command → cancel current operation, close session, `IDLE`.
- Any active state + lock/mute → cancel current operation, close session, disable capture and playback; readiness returns only when both conditions clear.
- Duration allowance expires → finish the current turn and transition to `AWAITING_EXTENSION` instead of opening another normal follow-up window; expiry between turns prompts immediately.

Enforce a configurable conversation duration allowance (initial default five minutes), maximum utterance duration, maximum history tokens, and separate watchdogs for stalled operations. Normal expiry occurs between turns; watchdog recovery may interrupt a stalled turn. Recognize a small deterministic set of standalone German voice control phrases, including “Stopp”, the PRD end phrases, “Weiter” while awaiting extension, and “Noch einmal” for retry. Words quoted or embedded in questions are not commands. Explicit commands take priority over LLM interpretation. Canceled operations must never deliver late events or replies into a newer turn.

### 4. Conversation memory

Hold turn history **in memory per session**. Retain completed exchanges and only the delivered portion of an interrupted reply; exclude unheard remainders and unanswered canceled questions from future context. Retain context while awaiting an explicit extension, then clear temporary audio and context on closure, lock, or mute. Optional persistent summaries/history require explicit user opt-in, clear retention controls, and visible delete functionality. Keep transient pre-roll buffers bounded. No STT transcripts, audio, prompt text, or tool payloads in routine logs by default.

Default to concise spoken German, with more detail on request. Speak summaries of code or large tables and indicate text availability. An explicit CLI option may display the current session's answer, including content unsuitable for speech, without saving it or adding it to routine logs. An unheard remainder of a stopped reply must not enter follow-up context merely because it was generated.

### 5. Tools and security

Tools are disabled unless separately configured. A future finance/stock tool may query external quotes and must disclose timestamp, source, and whether data is delayed; LLM knowledge is **not** a current-price source. Tool calls receive validated structured arguments, use allowlists, have timeouts, and return provenance. External access must be explicitly enabled per integration. Side-effecting actions (orders, purchases, shell commands, device controls) require permission and, where warranted, confirmation. Never let arbitrary LLM output execute a shell command. Bind local sockets to the user runtime directory (`$XDG_RUNTIME_DIR`) with restrictive permissions and authenticate any added HTTP API.

### 6. Runtime and startup

- Run `jarvis-audio.service` and `jarvis-core.service` as `systemd --user` units, `Restart=on-failure`, sensible restart limits, and readiness/health reporting.
- Use per-project Python virtual environment / lockfile and Node.js package lockfile; pin models with exact names, revisions and checksums in a model manifest.
- Keep configuration in `$XDG_CONFIG_HOME/jarvis/config.yaml`, state under `$XDG_STATE_HOME/jarvis`, and socket under `$XDG_RUNTIME_DIR/jarvis/` (create directories with correct permissions).
- Handle microphone unavailable, muted devices, audio device changes, GPU/LLM offline, suspend/resume, and hotplug without busy-looping or inadvertently turning on recording.
- Default to manual activation if wake model is missing, unlicensed, or not yet validated; report “manual activation available”. If STT or TTS is unavailable, report voice conversation unavailable with a clear CLI diagnostic.
- Service recovery must not replay work automatically. On an active-turn failure, give one brief error indication where possible, preserve context while the session remains open, and wait for “Noch einmal” or a new question. Avoid repeated audible idle errors.

### 7. Observability and performance

Instrument timestamps for audio wake, end-of-speech, STT final, LLM first token, first TTS audio, playback start/end, and interruption. Report p50/p95, CPU/RAM usage and **speech service VRAM**, without logging content. Measure cold and warm starts, short and long German queries, whisper/noise conditions, speakers/headsets, Ollama loaded/unloaded, 10-minute sessions, and multi-hour idle stability.

Initial **target**, not a hardware guarantee: p50 elapsed from end-of-user-speech to first audible answer ≤ 1.5 s for a short no-tool query with a preloaded small local LLM; p95 ≤ 3 s under a defined quiet benchmark. Record exact model + settings, make targets revisable after baseline. Speech stack should allocate **zero dedicated GPU VRAM by default** (other applications and GPU compositor are outside this budget).

Choose the initial speech and LLM configuration by comparing German accuracy, conversational usefulness, and measured latency on the target hardware. Include common English technical terms in the German corpus; dialects, prolonged dictation, and language switching are measured capabilities rather than MVP promises. Release reports distinguish passed, failed, and unvalidated requirements. Local inference, idle privacy, bounded capture, and cancellation are mandatory; missed latency targets require disclosed evidence and review. A useful release with documented gaps must not be described as having passed all P0 requirements.

### 8. Alternatives considered

- **One monolithic Node/Python process:** simpler deployment, but weaker fault isolation and library/backend boundaries.
- **Always-on GPU STT:** can speed recognition, but directly competes with local LLM for 16 GB VRAM. Reserve for benchmark-proven need.
- **Whisper for everything:** strong transcription but its utterance/segmentation model is less naturally suited to low-latency conversational partial recognition.
- **Fully open microphone after wake forever:** easier UX but poor privacy and false-turn behavior. Use bounded follow-up window.
- **System-wide root service:** unnecessarily broad privileges and awkward desktop audio access; rejected.
- **Cloud speech/LLM fallback:** incompatible with offline/local-first requirement; rejected.

## Consequences and risks

- Two-language implementation requires versioned protocol contracts and integration tests.
- German wake-word accuracy must be validated on the actual microphone; third-party training services may be non-local even if inference is local, so the source/provenance of the wake model must be disclosed.
- The Ryzen 5 5600 may become a bottleneck when STT, TTS and echo cancellation overlap. Choose the speech recognizer after measuring CPU load and latency.
- Acoustic echo cancellation does not guarantee robust barge-in. Gate release by objective false-interruption tests.
- Longer LLM context and external tool calls can dominate end-to-end delay despite fast speech processing.

## Validation gates before changing status to fully validated

1. Confirm reproducible model downloads, legal terms, and supported ONNX runtimes on CachyOS.
2. Compare at least two German-capable STT configurations with a reproducible German audio test set.
3. Validate “Hey Jarvis + command” recall and false-positive rate during continuous background playback.
4. Verify p50/p95 voice latency and RAM/CPU/VRAM on target hardware, with and without Ollama load.
5. Validate explicit ending, voice stop separately from general barge-in, noise/empty-recognition deadlines, duration extension, delivered-reply context, lock/mute, cancellation of late events, suspend/resume and restart scenarios. Manual activation can pass the MVP activation gate, but does not pass the hands-free gate or justify a fully validated wake-word claim.
6. Perform a privacy/permissions review before adding any internet-enabled tool.

## References (implementation verification)

- Piper Python streaming API: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md
- Piper project: https://github.com/OHF-Voice/piper1-gpl
- PipeWire echo cancellation: https://docs.pipewire.org/page_module_echo_cancel.html
- sherpa-onnx project: https://github.com/k2-fsa/sherpa-onnx
- Silero VAD: https://github.com/snakers4/silero-vad
- openWakeWord original project: https://github.com/dscripka/openWakeWord
- German wake-model training option (external training may use cloud): https://openwakeword.com/de
- Ollama API: https://github.com/ollama/ollama/blob/main/docs/api.md
