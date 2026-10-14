# 07: Failures, explicit retry, and capability recovery

**What to build:** Understand a failed turn through a brief indication and CLI health, recover local services safely, and retry only when you explicitly request it.

**Blocked by:** 04: Manual replacement and delivered-reply context.

**Status:** ready-for-agent

- [ ] Unavailable wake detection reports manual activation available; unavailable STT/TTS reports voice conversation unavailable, and Ollama failure reports the unavailable inference capability.
- [ ] An active-turn failure gives one brief indication where possible and retains context while the conversation remains open; idle failures do not produce repeated audible announcements.
- [ ] Standalone “Noch einmal” retries the available unsuccessful question, or a new question starts new work; service recovery alone never replays a question.
- [ ] Real local-socket disconnect/reconnect, process failure, operation timeout, and stalled-audio watchdog cases recover or expose degraded health without busy loops or stale reply delivery.
- [ ] Backpressure and queue limits prevent unbounded pending control/audio work; failure diagnostics and bounded logs contain no user content.
- [ ] Public-boundary and socket-contract checks prove explicit retry, unavailable capabilities, bounded recovery, queue limits, and immunity to canceled results.
- [ ] Document capability states, troubleshooting, watchdog/restart settings, service-recovery commands, and exact health/log-inspection steps.
