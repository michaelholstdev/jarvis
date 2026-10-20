# 17: End-to-end latency and resource benchmarks

**What to build:** Compare local-model configurations and see reproducible answer-latency and resource measurements for the actual voice conversation path.

**Blocked by:** 20: Production Parakeet recognition, before final headset model/latency acceptance.

**Status:** ready-for-human

## Remaining work plan — 2026-10-19

**Type:** Acceptance

**Outcome:** Select a useful German headset configuration and measure its real audible
response time. Start with a short human trial; run the full matrix once obvious
problems are fixed. Use [latency protocols](../../../docs/latency-benchmarks.md).

- [ ] Trial manual activation/cue, German and technical questions, contextual
  follow-ups, manual stop/replacement, delivered reply, explicit end, silence,
  retry, extension and temporary text access on the actual headset.
- [ ] Compare local LLM candidates on the same questions; record human ratings for
  correctness, relevance, concise German and intelligibility, alongside latency.
  Choose and document the model/settings from quality plus timing evidence.
- [ ] Complete at least 30 warm short queries and the cold, long, quiet/noisy,
  whisper and loaded/unloaded scenarios; record physical audible p50/p95 and
  CPU/RAM/speech VRAM, distinguishing incomplete samples and target misses.
- [ ] Record exact candidate SHA, device/gain, recognizer/voice/LLM hashes and
  settings; link focused bug tickets and rerun affected scenarios after fixes.

Speaker scenarios from the original criteria are tracked in #21. Spoken-stop
acoustics remain #14 and wake remains #13; neither is required to begin this
manual headset trial. Original criteria and historical evidence remain below.


- [x] Capture content-free timestamps for wake where enabled, speech endpoint, STT final, LLM first token, first TTS audio, playback start/end, and interruption.
- [ ] For at least 30 warm short local no-tool queries, compute speech-end-to-audible-answer p50/p95 against initial targets of at most 1.5 and 3 seconds.
- [x] Record exact speech/LLM model revisions, quantization, generation/context settings, voice, device, CPU/GPU state, and whether Ollama is loaded.
- [ ] Compare local LLM configurations for German conversational usefulness as well as latency, and include cold/warm, short/long, quiet/noisy, headset/speaker, and loaded/unloaded conditions as documented scenarios.
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

Validation: `npm run check` passed. The final post-review full `npm test` passed
**203 Node and 31 Python tests**; `git diff --check` passed. Reporting and
first-token instrumentation were implemented red → green at the user-approved
benchmark/report and daemon/audio seams. The metadata redirect regression also
failed before the explicit rejecting handler and passed afterward. A final real
synthetic daemon/audio smoke passed with the shared CPU loader (one sample,
819 ms signal proxy; insufficient for any target verdict and not substituted
for the published baseline).

## Standards review

Initial review found one documented breach (urllib's default redirect following
contradicted loopback-only metadata requests) and one possible duplication smell
(CPU voice construction duplicated between production and stress measurement).
Both were corrected: explicit redirect rejection with a public request-behavior
regression, and shared pinned `load_cpu_voice`. Follow-up reviewer: both original
findings resolved; **0 remaining defects or documented-standard breaches**.

## Spec review

Independent reviewer recomputed both 30-trial percentile results, verified all
six required measured stages in all 60 traces, and confirmed published resource
summaries. **Two partial acceptance findings remain:** physical audible latency;
and German conversational usefulness plus remaining scenario measurements. Both
requirements remain unchecked and the status remains `ready-for-human`.
Follow-up reviewer confirmed accurate tracker status, preserved CPU settings and
no new software defect. These human acceptance gaps are not represented as
resolved by the synthetic proxy or keyword screen.

## Review correction: collection lifetime and resource evidence

Fixed all three software findings from the fresh review:

- Diagnostic readers, signal monitors and the resource sampler now have checked
  lifetimes. Unexpected EOF or a collection exception prevents publication of a
  completed report with a fixed content-free error. Prior incomplete checkpoints
  remain unvalidated. Cleanup still stops all collectors and services.
- Collectors stop and are awaited before mute/teardown. Summaries and raw resource
  data are produced from the same frozen sample set, preventing late idle samples.
  Both baseline artifacts retain their original 30 resident-idle samples; the
  excluded teardown sample is preserved verbatim separately with correction
  provenance. Latency trials, percentiles and active measurements are unchanged.
- The output guide now documents `interruption`, its monotonic timestamp,
  operation ID and optional cancellation target, matching actual diagnostics.

Validation: `npm run check` and full `npm test` pass (**203 Node / 35 Python**).
Eight focused benchmark tests include regressions for the published evidence,
frozen collection, malformed/closed diagnostic streams, and an external `/proc`
inspection failure after valid samples. The artifact and collector regressions
were observed red before correction. A real synthetic daemon/audio smoke passes
(805 ms signal proxy for one sample, insufficient for target validation); every
resource summary matches its frozen raw samples. A real benchmark invocation with
an injected external `/proc` failure aborts without a completed report.
`git diff --check` passes.

Follow-up Standards reviewer: both findings resolved, no remaining/new actionable
code defect. Follow-up Spec reviewer independently verified corrected idle counts,
all resource summaries, verbatim excluded rows and unchanged latency evidence;
original software defect resolved, no new correction defect. The two previously
recorded **human acceptance gaps remain open**: physical audible latency and human
German usefulness/remaining scenario measurements. Fixing software and evidence
consistency does not establish those acoustic or quality results.

### Active next task — user decision, 2026-10-20

Claimed by Codex for beginning physical headset acceptance after #18's scoped
closure. #20 is implemented; its historical dependency is satisfied. Start with
a short real headset conversation before the full 30-query/model-comparison
matrix. Record the current Git revision and actual device/configuration for each
trial. Setup-specific failures become focused tickets with preserved evidence.

Wake #13 is already implemented and experimentally enabled at threshold 0.2;
accepted measured recall is 23/30. Historical text saying wake is unavailable is
superseded by #13's current outcome. Preserve that user decision. This trial can
use deliberate manual activation while recording the actual wake setting.

Continue using [the fresh-context handoff](../headset-acceptance-handoff.md).
No physical #17 test or model-selection decision is claimed by this preparation.

### Headset acceptance started — 2026-10-20

Fresh-context inspection and first manual activation are recorded in the
[content-free headset trial note](../headset-acceptance-2026-10-20.md).
Candidate `003847bea329d3f97420d7e93b66e57895db00bb`; existing local preparations
preserved. User confirmed Jieli input / Starship analog headset output and
readiness; services restarted with unchanged voice configuration and wake 0.2.
The first attempt reached recognition and then idle without an LLM operation;
human observations are pending. No conversational-quality, audible-latency or
model-selection pass is claimed. Status remains `ready-for-human`.

Follow-up: user identified wake activation with a greeting-like reply instead of
executing the attached question. [#26](26-wake-integrated-question.md) records
real-model replay and a local pre-roll adjustment from 750 to 1000 ms. The user
reports the live rerun works substantially better. Retain this setup for further
acceptance; no general wake, human quality score or audible-latency pass is
claimed. Next short-trial item: manual interruption/replacement and ending.
