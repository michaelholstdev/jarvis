# 17: End-to-end latency and resource benchmarks

**What to build:** Compare local-model configurations and see reproducible answer-latency and resource measurements for the actual voice conversation path.

**Blocked by:** 11: Concise speech and temporary text answers; 15: Real playback delivery in follow-up context.

**Status:** ready-for-agent

- [ ] Capture content-free timestamps for wake where enabled, speech endpoint, STT final, LLM first token, first TTS audio, playback start/end, and interruption.
- [ ] For at least 30 warm short local no-tool queries, compute speech-end-to-audible-answer p50/p95 against initial targets of at most 1.5 and 3 seconds.
- [ ] Record exact speech/LLM model revisions, quantization, generation/context settings, voice, device, CPU/GPU state, and whether Ollama is loaded.
- [ ] Compare local LLM configurations for German conversational usefulness as well as latency, and include cold/warm, short/long, quiet/noisy, headset/speaker, and loaded/unloaded conditions as documented scenarios.
- [ ] Measure idle and active/concurrent speech CPU/RAM and dedicated speech-service VRAM separately from Ollama/compositor usage; confirm zero dedicated speech-inference VRAM in the default setup or report a failure.
- [ ] Publish commands, prerequisites/model setup, sample counts, environment details, results, and a reproducible regression baseline without conversation content.
- [ ] Missed targets remain disclosed; any revised target includes evidence and review rather than retroactively marking a failed measurement passed.
