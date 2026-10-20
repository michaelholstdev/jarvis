# Selectable independently managed local inference

Accepted, 2026-10-20, ticket #27. Expand ADR-0001's Ollama-only inference
choice to include llama.cpp's streamed chat completions API. Keep protocol
selection behind the inference boundary so the existing conversation state
machine owns cancellation, completed exchanges, delivered reply context and
explicit retry for either backend. This supports already installed GGUF models
without a second conversation implementation or an Ollama dependency.

Jarvis owns neither inference service nor model acquisition. The llama.cpp
server owns its context capacity, model loading, chat template and GPU placement;
Jarvis selects its endpoint/model and bounded generation settings. Ollama and
mock configurations remain compatible. Automatic backend fallback is excluded.
See [configuration and operating procedure](../llama-cpp.md).
