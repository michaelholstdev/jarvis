# 10: Local Ollama voice conversations

**What to build:** Ask a real German question, hear a locally generated answer, and continue with contextual follow-ups while retaining reliable cancellation and explicit retry.

**Blocked by:** 07: Failures, explicit retry, and capability recovery; 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [ ] Final recognition and current allowed context drive streamed generation from independently managed Ollama over loopback; speech waits for the completed answer because early TTS is deferred.
- [ ] Model, generation settings, local endpoint, and context limits are configurable; the illustrative context limit is 8192 tokens rather than a quality or latency guarantee.
- [ ] Real audio input/output integrates with existing follow-up, end, manual replacement, cancellation, and explicit retry behavior.
- [ ] Canceled Ollama requests and late streamed output cannot speak into another turn; unavailable inference produces a brief active-turn indication and meaningful capability health.
- [ ] A loopback Ollama fake server covers normal streaming, errors, timeout, and cancellation deterministically; an optional real-service smoke test demonstrates a complete local voice exchange.
- [ ] Preinstalled models and local services support offline inference; no external data tool, shell execution, or cloud fallback is introduced.
- [ ] Document local Ollama installation/startup and loopback configuration, model acquisition/revision recording, generation/context settings, health verification, start/stop, and troubleshooting; keep model selection provisional pending benchmarks.
