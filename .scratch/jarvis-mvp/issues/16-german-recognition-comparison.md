# 16: German recognition comparison

**What to build:** Choose an initial CPU recognition configuration using a reproducible comparison of German transcription quality and latency on the target machine.

**Blocked by:** 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [ ] A fixed consented or synthetic corpus contains at least 30 German utterances, including common English technical terms, with reference transcripts and provenance.
- [ ] Compare at least two German-capable CPU configurations, including the planned Parakeet TDT v3 INT8 candidate where supported and a small true-streaming alternative; record compatibility limitations rather than inventing results.
- [ ] Report recognition errors and latency by configuration, exact model revisions/checksums, quantization, settings, runtime, and hardware state.
- [ ] Document the evaluation method and quality gate used to choose the initial recognizer; distinguish endpointed/chunked behavior from true partial streaming.
- [ ] Measure dialect/dictation/language-switching examples only as capabilities/limitations, without expanding guaranteed MVP scope.
- [ ] Provide reproducible installation/download/verification and benchmark commands plus corpus instructions; keep unmeasured configurations explicitly unvalidated.
- [ ] The published comparison recommends a configuration based on evidence and retains the replaceable recognizer interface rather than promising unmeasured speed or accuracy.
