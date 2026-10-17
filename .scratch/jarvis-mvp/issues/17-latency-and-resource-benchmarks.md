# 17: End-to-end latency and resource benchmarks

**What to build:** Compare local-model configurations and see reproducible answer-latency and resource measurements for the actual voice conversation path.

**Blocked by:** 11: Concise speech and temporary text answers; 15: Real playback delivery in follow-up context.

**Status:** ready-for-human

- [x] Capture content-free timestamps for wake where enabled, speech endpoint, STT final, LLM first token, first TTS audio, playback start/end, and interruption.
- [ ] For at least 30 warm short local no-tool queries, compute speech-end-to-audible-answer p50/p95 against initial targets of at most 1.5 and 3 seconds.
- [x] Record exact speech/LLM model revisions, quantization, generation/context settings, voice, device, CPU/GPU state, and whether Ollama is loaded.
- [x] Compare local LLM configurations for German conversational usefulness as well as latency, and include cold/warm, short/long, quiet/noisy, headset/speaker, and loaded/unloaded conditions as documented scenarios.
- [x] Measure idle and active/concurrent speech CPU/RAM and dedicated speech-service VRAM separately from Ollama/compositor usage; confirm zero dedicated speech-inference VRAM in the default setup or report a failure.
- [x] Publish commands, prerequisites/model setup, sample counts, environment details, results, and a reproducible regression baseline without conversation content.
- [x] Missed targets remain disclosed; any revised target includes evidence and review rather than retroactively marking a failed measurement passed.

## Comments

Claimed for implementation; baseline `1c1426554d5c9ab04c37963bcebda7fc1e2ab736`.

## Answer

Implemented content-free monotonic stage instrumentation, turn/operation correlation,
actual daemon + PipeWire monitor benchmark commands, nearest-rank reports, strict
same-configuration regression comparison, and separate idle/concurrent CPU speech
resource measurement. Published [method, commands, prerequisites, results and remaining
scenario protocols](../../../docs/latency-benchmarks.md), with content-free raw
baselines under `benchmarks/latency/`.

Thirty warm short local no-tool queries **per configuration** completed: Gemma 3
270M Q8_0 signal-proxy p50/p95 770/1007 ms; Llama 3 8B Q4_0 1265/1625 ms. Both
pass the original latency numbers **only for the silent-sink signal proxy**;
physical speech-end-to-audible-answer acceptance remains unvalidated, so that
checkbox stays open. The separately recorded Llama initial query was 5249 ms.
Required-concept screens passed only 6/30 and 11/30; no production conversational
model is selected and human German usefulness ratings remain unvalidated.

Resident idle and active speech CPU/RAM are published separately from Ollama and
compositor GPU state. The separate simultaneous STT/TTS CPU stress run observed
zero dedicated speech VRAM in every sample (30 idle / 104 concurrent). Real voice
runs observed no nonzero allocation but had 4/1724 and 3/2461 unknown active
inspection samples, explicitly disclosed as a coverage failure/unvalidated gate.
No target revision or physical-acoustic pass is claimed.

**Ready for human:** actual headset/speaker audibility measurements, German
conversation ratings, and the documented long/noisy/whisper, controlled cold/load
scenarios. Wake remains unavailable under #13. Synthetic baseline implementation
is complete; the issue is not represented as fully acoustically validated.

Map pointer: [implementation map](../map.md).
