# Jarvis MVP implementation map

- [01: Runnable mock services and health](issues/01-runnable-mock-services-and-health.md#answer) — resolved; M0 foundation implemented and all local checks pass.
- [02: Manual activation with scripted answer](issues/02-manual-activation-scripted-answer.md) — resolved; scripted turn and delivery checks pass.
- [03: Contextual follow-ups and explicit ending](issues/03-contextual-follow-ups-and-ending.md#answer) — resolved; fake-clock and socket checks pass.
- [04: Manual replacement and delivered context](issues/04-manual-replacement-delivered-context.md#answer) — resolved; cancellation, delivery-context and CLI checks pass.
- [05: Conversation expiry and extension](issues/05-conversation-expiry-and-extension.md#answer) — resolved; fake-clock expiry/extension and daemon/Python socket checks pass.
- [06: Lock and mute privacy](issues/06-lock-and-mute-privacy.md#answer) — resolved; independent inhibition, cleanup and socket checks pass.
- [07: Failure, retry and capability recovery](issues/07-failure-retry-capability-recovery.md#answer) — resolved; explicit retry, capability health, bounded socket recovery and diagnostics implemented.
- [08: Real German synthesis and playback](issues/08-german-synthesis-and-playback.md#answer) — resolved; pinned CPU Piper output, stable sink selection, resampling, drained completion and cancellation verified on a silent PipeWire sink.
- Remaining tickets are in [issues/](issues/); other M1–M4 gates remain open.
