# 16: German recognition comparison

**What to build:** Choose an initial CPU recognition configuration using a reproducible comparison of German transcription quality and latency on the target machine.

**Blocked by:** 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [x] A fixed consented or synthetic corpus contains at least 30 German utterances, including common English technical terms, with reference transcripts and provenance.
- [x] Compare at least two German-capable CPU configurations, including the planned Parakeet TDT v3 INT8 candidate where supported and a small true-streaming alternative; record compatibility limitations rather than inventing results.
- [x] Report recognition errors and latency by configuration, exact model revisions/checksums, quantization, settings, runtime, and hardware state.
- [x] Document the evaluation method and quality gate used to choose the initial recognizer; distinguish endpointed/chunked behavior from true partial streaming.
- [x] Measure dialect/dictation/language-switching examples only as capabilities/limitations, without expanding guaranteed MVP scope.
- [x] Provide reproducible installation/download/verification and benchmark commands plus corpus instructions; keep unmeasured configurations explicitly unvalidated.
- [x] The published comparison recommends a configuration based on evidence and retains the replaceable recognizer interface rather than promising unmeasured speed or accuracy.

## Comments

Claimed for implementation; baseline `f6f49307e9137acc69a4e98f2152c15d72f7751c`. Agreed TDD seam: public scoring/report interface (errors, subgroups, quality gate).

## Answer

Implemented the reproducible CPU comparison with 30 original synthetic German
utterances (20 standard, 10 technical) and three separately scored capability probes.
The published [comparison](../../../docs/recognition-comparison.md) recommends
Parakeet TDT v3 INT8, CPU/two threads/greedy search for the next production adapter:
it alone passes the fixed synthetic gate (6.7% core WER, 246 ms p95 compute).
Whisper tiny INT8 yields 29.8% WER; true-streaming Vosk small German yields 19.1%
overall and fails the technical gate. Exact hashes/revisions, runtime/settings,
hardware state, raw hypotheses, per-group errors, load/compute timings and corpus
provenance are committed under `benchmarks/recognition/` with download, verification,
synthesis and benchmark commands. Actual CPU is a 5600X, explicitly distinguished
from the architecture's 5600. Production recognizer interface/configuration remains
replaceable and unchanged; integration of the selected candidate, real microphone
accuracy, authentic dialects, prolonged dictation, concurrent Ollama and acoustic
release acceptance are unvalidated. No service model is marked validated.

Map pointer: [implementation map](../map.md).

Validation: `npm run check` passed (including benchmark lint/typechecking); the full
`npm test` passed **203 Node and 24 Python tests**. The three scoring/report tests
were implemented red → green at the user-confirmed seam. `git diff --check` passed.
Code review against `f6f4930`: **Standards 0 findings**, **Spec 0 findings**.
The Spec reviewer independently recomputed all committed summaries and reran
Parakeet: 6.7% core WER, 16.7% technical WER, passing gate, 256 ms p95 compute.
That reproduction is corroboration, not a replacement for the published three-pass
measurement (246 ms p95).
