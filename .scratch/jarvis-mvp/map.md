# Jarvis MVP implementation map

- [01: Runnable mock services and health](issues/01-runnable-mock-services-and-health.md#answer) — resolved; M0 foundation implemented and all local checks pass.
- [02: Manual activation with scripted answer](issues/02-manual-activation-scripted-answer.md) — resolved; scripted turn and delivery checks pass.
- [03: Contextual follow-ups and explicit ending](issues/03-contextual-follow-ups-and-ending.md#answer) — resolved; fake-clock and socket checks pass.
- [04: Manual replacement and delivered context](issues/04-manual-replacement-delivered-context.md#answer) — resolved; cancellation, delivery-context and CLI checks pass.
- [05: Conversation expiry and extension](issues/05-conversation-expiry-and-extension.md#answer) — resolved; fake-clock expiry/extension and daemon/Python socket checks pass.
- [06: Lock and mute privacy](issues/06-lock-and-mute-privacy.md#answer) — resolved; independent inhibition, cleanup and socket checks pass.
- [07: Failure, retry and capability recovery](issues/07-failure-retry-capability-recovery.md#answer) — resolved; explicit retry, capability health, bounded socket recovery and diagnostics implemented.
- [08: Real German synthesis and playback](issues/08-german-synthesis-and-playback.md#answer) — resolved; pinned CPU Piper output, stable sink selection, resampling, drained completion and cancellation verified on a silent PipeWire sink.
- [09: Manual microphone question and scripted spoken reply](issues/09-microphone-question-scripted-reply.md#answer) — resolved; optional PipeWire capture, CPU Silero/Whisper, privacy cancellation, and real synthetic German core/socket/playback checks pass; hardware accuracy remains unvalidated.
- [10: Local Ollama voice conversations](issues/10-local-ollama-voice-conversations.md#answer) — resolved; streamed loopback generation, automatic bounded microphone follow-ups, cancellation, retry and capability health verified with fake services; real Ollama adapter check passed, full speech/hardware smoke remains unvalidated.
- [11: Concise speech and temporary text answers](issues/11-concise-speech-temporary-text.md#answer) — resolved; German style instructions, Markdown-aware summaries, frame-bounded CLI text access, delivered-only context and privacy cleanup verified; all review findings resolved; final checks and 176 Node/9 Python tests pass.
- [12: Login startup, KDE activation, and device recovery](issues/12-login-kde-device-recovery.md#answer) — implementation complete; user units, real desktop inhibition/recovery and lifecycle docs added; 181 Node/9 Python tests pass. Target KDE/hardware acceptance remains unvalidated and M3 stays open.
- Remaining tickets are in [issues/](issues/); other M1–M4 gates remain open.
