# 10: Local Ollama voice conversations

**What to build:** Ask a real German question, hear a locally generated answer, and continue with contextual follow-ups while retaining reliable cancellation and explicit retry.

**Blocked by:** 07: Failures, explicit retry, and capability recovery; 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [x] Final recognition and current allowed context drive streamed generation from independently managed Ollama over loopback; speech waits for the completed answer because early TTS is deferred.
- [x] Model, generation settings, local endpoint, and context limits are configurable; the illustrative context limit is 8192 tokens rather than a quality or latency guarantee.
- [x] Real audio input/output integrates with existing follow-up, end, manual replacement, cancellation, and explicit retry behavior.
- [x] Canceled Ollama requests and late streamed output cannot speak into another turn; unavailable inference produces a brief active-turn indication and meaningful capability health.
- [x] A loopback Ollama fake server covers normal streaming, errors, timeout, and cancellation deterministically; an optional real-service smoke test demonstrates a complete local voice exchange.
- [x] Preinstalled models and local services support offline inference; no external data tool, shell execution, or cloud fallback is introduced.
- [x] Document local Ollama installation/startup and loopback configuration, model acquisition/revision recording, generation/context settings, health verification, start/stop, and troubleshooting; keep model selection provisional pending benchmarks.

## Comments

Implemented on the current branch against baseline `78407f2400cd2ca40ad2a9970c018e9a27877826`. Review uses the public core/runtime and local fake Ollama seams specified in the MVP spec. Final validation and review findings will be recorded below.

## Answer

Resolved: opt-in `llm.mode: ollama` generates streamed answers through direct
loopback HTTP from the final transcript and the core's allowed delivered context.
Piper waits for completed generation. Model, endpoint, context window, generation
budget, temperature, seed and total generation watchdog are configurable. Defaults
remain hardware-free mocks; no downloader, external tool, shell execution, redirect,
proxy forwarding or cloud fallback was added. Independently managed Ollama must
run in local-only mode as documented.

Real voice mode automatically captures bounded follow-ups and extension commands
after playback. One content-free speech-onset frame carries the original deadline
and bounded recognition completion allowance across the audio socket. Explicit
ending, retry, privacy, replacement and cancellation retain the existing core
rules. Operation invalidation aborts obsolete HTTP/audio requests; stale results
cannot synthesize into another turn. Active inference failure requests one brief
cue and retains the unsuccessful question for explicit retry; non-generating,
coalesced model probes update inference capability without replay. Health now
reports operational real manual/voice availability separately from mock readiness.

See [Ollama setup](../../../docs/ollama.md) for installation/startup, local-only
configuration, offline preparation, model acquisition and full digest/license
recording, generation/context limits, health, operation and troubleshooting.
The optional real-service synthetic voice command extends `scripts/verify-input.py`
with an Ollama model argument; it checks actual recognition, completed generation,
Piper synthesis and drained playback through temporary silent PipeWire devices.

Validation: `npm run check` passed; the final full `npm test` rebuilt sources and
passed **138 Node tests and 9 Python tests**. Fake loopback coverage includes
stream completion, request history/settings, HTTP failures, malformed/incomplete/
empty/oversized replies, timeout, abort, redirects, formatted model-list responses,
completed-answer speech, delivered-context follow-up, explicit retry, late-result
rejection, inference capability recovery and automatic daemon voice ending.
The busy-microphone daemon regression reproduced the review race, then passed
manual reactivation with acknowledgment sounds enabled and disabled.

A real loopback Ollama adapter smoke check passed using the already installed
`gemma3:270m`, digest
`e7d36fb2c3b3293cfe56d55889867a064b3a2b22e98335f2e6e8a387e081d6be`,
context 8192, `num_predict:64`, temperature 0.3 and seed 0. It produced a completed
43-byte answer; only metadata was printed. This tiny model is an integration
fixture, not a model-quality recommendation. The optional **complete real speech
smoke command remains unrun** here because speech artifacts are absent. Physical
microphone/headset/speaker acceptance, offline hardware operation, accuracy,
resource/latency benchmarks and real delivered-speech precision remain unvalidated.

### Standards review

Initial review found no documented-standard breaches and one possible Mysterious
Name: the real production adapter driver was still called `runMockTurn` in
`mock-turn.ts`. Renamed it to `runTurn` in `turn-driver.ts` and updated callers.
Independent re-review confirmed **0 remaining Standards findings**.

### Spec review

Initial review found one P1: reactivation during automatic follow-up could start
acknowledgment while the microphone worker was still busy. Real follow-up
reactivation now explicitly cancels capture; audio cancellation waits until old
work becomes idle before acknowledging, and obsolete disconnected clients cannot
stop a newer worker generation. The regression failed before the fix and passes
with/without the cue. Independent re-review confirmed **0 remaining Spec findings**.

Review baseline: `78407f2400cd2ca40ad2a9970c018e9a27877826`;
implementation `2781094`, corrections `0015df1`. Final findings: Standards **0**,
Spec **0**; no remaining issue within either axis.

Map pointer: [implementation map](../map.md).
