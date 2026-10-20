# 27: Use an existing llama.cpp server for local voice conversations

**Type:** Feature

**Status:** ready-for-human

**Blocked by:** None for implementation; actual server address, launch settings
and selected model must be inspected before the live integration test.

## Outcome

Allow Jarvis to use a locally managed `llama-server` and existing GGUF models
instead of Ollama. The user reports llama.cpp and models are already installed.
Jarvis currently calls Ollama-specific `/api/chat` and `/api/tags`, and its
configuration admits only the Ollama provider. Changing `llm.base_url` alone
does not provide compatibility.

Keep Ollama available and preserve existing configurations. Select the inference
backend, local endpoint and model explicitly in Jarvis configuration. Leave
microphone, wake, STT, TTS and conversation semantics independent of that choice.

## Scope and acceptance criteria

- [x] Inspect the installed llama.cpp version, service/start command, local
  endpoint, model identifier, context capacity and GPU placement without changing
  independently managed services. No installation or model download is assumed
  necessary; report missing prerequisites rather than acquiring them automatically.
- [x] Extend validated config/default loading to select llama.cpp while retaining
  compatibility with current Ollama and mock setups. Document the supported
  combination of mode/provider fields and reject inconsistent configurations.
- [x] Add an adapter for streamed `POST /v1/chat/completions`. Correctly parse SSE
  across arbitrary transport chunks and terminal events; collect assistant answer
  content without speaking reasoning/tool payloads. Preserve the German system
  instruction, completed exchanges, delivered reply context and output limits.
- [x] Map output-token, temperature and seed settings deliberately. Document
  which context/model settings belong to the server launch configuration rather
  than pretending an Ollama `num_ctx` option changes server capacity. Use the
  configured model identifier/alias accepted by the installed server.
- [x] Provide a bounded, non-generating readiness/model check using the installed
  server's health/model endpoints. Distinguish loading, missing model and server
  failure from ready inference. Health probes must not generate answers or replay
  questions; preserve explicit retry behavior after recovery.
- [x] Preserve loopback-only requests, no redirects/cloud fallback/downloads,
  content-free diagnostics, bounded responses and existing inference timeouts.
  Manual replacement, stop, lock and mute cancel in-flight HTTP generation;
  canceled results cannot enter a newer turn. Refuse tool execution.
- [x] Verify through a local HTTP fixture: SSE framing, normal and contextual
  answers, completion/empty/malformed/error responses, timeouts, cancellation,
  stale events and readiness. Keep existing Ollama regressions passing and run
  repository checks appropriate to the final changes.
- [x] Document setup and model selection, server-owned context/GPU settings,
  service startup order, health inspection and switching back to Ollama. Do not
  start/stop/reconfigure the user's llama.cpp service without session authorization.
- [x] Run one actual installed-server integration check, then a user-ready headset
  trial with a German question, contextual follow-up and cancellation. Record exact
  source, model/settings and content-free outcomes. Track unperformed hardware or
  quality checks explicitly; successful API integration does not pass #17's full
  model/quality/latency matrix.

## Architecture context

[ADR-0001](../../../docs/ADR-0001-architecture.md) currently names Ollama as the
independently managed inference process. Supporting llama.cpp expands that accepted
backend choice: document the decision in the implementation rather than silently
contradicting the ADR. Keep backend protocol differences behind the inference
boundary used by the conversation core; avoid a second conversation state machine.

## References

- [Official llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
  — chat completions, streaming, health and model endpoints; verify against the
  installed version during implementation.
- Existing adapter: `apps/core/ollama.ts`; integration: `apps/core/turn-driver.ts`,
  `apps/core/main.ts`, `apps/core/audio-deadline.ts`; config schema:
  `packages/protocol/schemas/config.schema.json`.
- [#10: existing Ollama integration](10-local-ollama-voice-conversations.md)
- [#17: headset acceptance/model selection](17-latency-and-resource-benchmarks.md)
- [MVP implementation map](../map.md)

## Comments

Requested by the user for later implementation. Unclaimed; no adapter or runtime
change is delivered by creating this issue. A brief process/service inspection
during discussion found Ollama running but did not identify a running llama.cpp
server; this does not disprove the user's installed service/models. Implementation
can begin without blocking on hardware acceptance or changing the current #17
headset setup.

Claimed by Codex for implementation on 2026-10-20. Existing tracker and
headset acceptance edits are preserved.

## Answer

Implementation delivered with selectable llama.cpp/Ollama inference, shared
bounded loopback transport and conversation context, streaming SSE validation,
non-generating readiness and cancellation. See [setup](../../../docs/llama-cpp.md),
[ADR-0002](../../../docs/adr/0002-selectable-local-inference.md), and
[content-free live API/headset evidence](../llama-cpp-acceptance-2026-10-20.md).
The authorized installed-server API check and physical headset trial were run;
human quality feedback remains explicitly pending. Full #17 model/quality/latency
acceptance remains separate. Temporary processes stopped; installed services and
original Ollama configuration restored. No persistent service change delivered.

Code-review: Standards and Spec clear after resolving shared-transport duplication.
[Map pointer](../map.md). Status ready-for-human records the outstanding human
quality assessment, not missing adapter implementation.

Final repository checks passed: `npm run check`; `npm test` (253 Node, 66 Python).
