# Release checklist — manual-only candidate, 2026-10-19

**No validated MVP release is claimed.** Ticket #19 consolidates an
[installation runbook](installation.md) and existing evidence. Fresh-account
installation, physical desktop/device acceptance and several M4 measurements
remain open. This record applies to the existing CachyOS development checkout;
it does not certify the nominal target hardware or a newly installed account.

Baseline before documentation work: `9a1af0917a7a38af77d6aed9a5231eb1f6caeea2`.
The production configuration accepts explicit Parakeet TDT v3 INT8 or Whisper tiny INT8, Silero and Thorsten
medium CPU speech; wake and spoken stop default off. Real voice requires explicit
Ollama/device/model configuration; shipped defaults are mocks. Existing reports
identify their own measured commits/configurations, which take precedence over
this consolidation date. No new acoustic measurements were made for #19.

## Verdict rules and mandatory gates

**Passed** means the named test setup supplies evidence for the stated criterion.
**Failed** means an observed result misses its declared criterion.
**Unvalidated** means evidence is missing, incomplete or insufficient for that
setup. P1 is explicitly deferred. A software pass is not a physical-device pass.
The PRD remains authoritative; no target revision is approved by this document.

| Mandatory release gate | Existing evidence | Target manual setup | Release decision |
| --- | --- | --- | --- |
| Local inference, no cloud fallback | Passed for disconnected synthetic voice: loopback-only namespace, initial + 30 turns; no external routes | Unvalidated fresh installation; external request-attempt audit also unvalidated | Keep gate open; verify local-only Ollama and offline functionality on installed setup |
| Idle privacy, no STT/LLM or persistent ambient recording | Passed software/manual-idle and privacy regressions; manual idle opens no microphone | Unvalidated physical lock/mute, actual idle capture inspection and fresh login | Keep gate open; any inhibited capture is a failure |
| Bounded capture and transient buffers | Passed software deadlines/pre-roll bounds/noise tests | Unvalidated physical capture cessation and internal queue/buffer occupancy acceptance | Keep gate open; any unbounded capture is a failure |
| Cancellation and no late/replayed work | Passed socket/core cancellation, real silent-sink interruption and delivered-prefix checks | Unvalidated actual device tail, lock/mute timing and desktop recovery | Keep gate open; replay or cancellation failure blocks release |

A failure in any mandatory gate prevents a release claim. Missing evidence also
prevents claiming the gate passed. Manual activation can satisfy the activation
gate; optional wake success is not required. A useful limited release can disclose
FR-09's unreliable/unvalidated spoken stop and retain manual cancellation, but
must not claim every P0 requirement passed. This candidate has additional open
quality/stability/installation gates and is not yet accepted as that release.

## Requirement matrix (PRD FR-01–FR-25)

The software/evaluation column records only the stated scope. Headset and speaker
columns refer to actual physical devices on the target desktop, including the
fresh account. Neither setup has a completed acceptance record. P1 rows have no
acceptance claim. Source links contain reproduction commands and limitations.

| Requirement | Software / existing evaluation | Headset | Speakers | Evidence and remaining work |
| --- | --- | --- | --- | --- |
| FR-01 Login startup | Unvalidated actual login; unit/lifecycle tests passed | Unvalidated | Unvalidated | [User units](../systemd/README.md); fresh login without terminal required |
| FR-02 Idle privacy | Passed manual-only software scope; no idle microphone/STT/LLM | Unvalidated | Unvalidated | [Privacy/stability](stability-acceptance.md); inspect physical capture and idle; wake disabled |
| FR-03 Activation + utterance | Passed synthetic manual path; wake unvalidated | Unvalidated | Unvalidated | [Input check](audio-input.md); single-press cue/capture and clipping acceptance required |
| FR-04 German STT | **Failed** Whisper synthetic quality screen; Parakeet passed synthetic screening and production service integration | Unvalidated | Unvalidated | [30-utterance comparison](recognition-comparison.md); [production setup](parakeet-production.md); accept selected recognizer with human speech |
| FR-05 Spoken response | Passed synthetic synthesis and mock summary/text behavior; real intelligibility/model quality unvalidated | Unvalidated | Unvalidated | [Output](audio-output.md), [text](text-answers.md); no LLM quality selection |
| FR-06 Follow-up context | Passed 30 contextual socket turns + real synthetic follow-up capture; human usefulness unvalidated | Unvalidated | Unvalidated | [Stability](stability-acceptance.md), [delivered context](delivered-context.md) |
| FR-07 Timeout | Passed fake-clock/socket noise, empty result and completion-bound tests | Unvalidated | Unvalidated | [Timing rules](../README.md#contextual-follow-ups-and-ending-03); validate physical silence/noise |
| FR-08 Explicit end | Passed deterministic/socket phrase matching and cleanup | Unvalidated | Unvalidated | [Stability](stability-acceptance.md); real spoken phrase/cleared access required |
| FR-09 Stop playback | Unvalidated acoustic voice stop; manual stop and deterministic control tests passed | Unvalidated | Unvalidated | [Spoken stop](spoken-stop.md); opt-in feature off, manual cancel does not pass FR-09 |
| FR-10 Resilience | Passed simulated desktop/recovery cases | Unvalidated | Unvalidated | [Desktop steps 7–9](desktop-acceptance.md); actual unplug/replug/backend/restart/suspend needed |
| FR-11 CPU speech / no dedicated speech VRAM | Passed sampled idle/concurrent CPU workload; full active-path coverage unvalidated | Unvalidated | Unvalidated | [Resources](latency-benchmarks.md); unknown samples prevent whole-run VRAM pass |
| FR-12 Configuration | Passed schema/defaults/loader tests | Unvalidated installed setup | Unvalidated installed setup | [Configuration](configuration.md), [installation](installation.md); verify both processes share config |
| FR-13 Logging/privacy | Passed content-free software regression scope; narrow soak screen only | Unvalidated | Unvalidated | [Stability](stability-acceptance.md); no raw audio/transcripts/prompts; complete hardware/log inspection |
| FR-14 Tool isolation | Passed current no-tool request/adapter scope; tools disabled | Unvalidated installed setup | Unvalidated installed setup | [Ollama](ollama.md); no shell/finance/tool adapter, external-attempt audit remains unvalidated |
| FR-15 Barge-in | Deferred P1 | Deferred P1 | Deferred P1 | Disabled; manual replacement is a separate capability |
| FR-16 Early speech | Deferred P1 | Deferred P1 | Deferred P1 | Entire LLM response precedes speech; streaming HTTP is not early speech |
| FR-17 Tray | Deferred P1 | Deferred P1 | Deferred P1 | No tray dependency |
| FR-18 Finance tool | Deferred P1 | Deferred P1 | Deferred P1 | No current-data/financial integration |
| FR-19 Lock/mute privacy | Passed independent inhibition, cleanup and late-event software checks | Unvalidated | Unvalidated | [Desktop steps 4–6](desktop-acceptance.md); mute switch must expose source mute, never resume old work |
| FR-20 Manual replacement | Passed core/socket cancellation and obsolete-result checks | Unvalidated | Unvalidated | [Replacement](../README.md#manual-replacement-and-stop-playback-04); measure device stop/cue/capture |
| FR-21 Delivered context | Passed socket/fake-Ollama + real independently monitored silent-sink prefix checks | Unvalidated | Unvalidated | [Delivery precision](delivered-context.md); fully drained sentences only, physical demo remains open |
| FR-22 Expiry/extension | Passed fake-clock and timed socket extension rules | Unvalidated | Unvalidated | [Stability](stability-acceptance.md); real spoken Weiter/end and prolonged conversation required |
| FR-23 Text answer | Passed daemon/CLI paging, lifetime and cleanup tests | Unvalidated installed setup | Unvalidated installed setup | [Text access](text-answers.md); terminal copies outlive session cleanup |
| FR-24 Capability health | Passed unavailable/ready/retry/recovery software checks | Unvalidated installed setup | Unvalidated installed setup | [Health](recovery.md); operational ready is not acoustic quality, no automatic replay |
| FR-25 Audible readiness | Passed distinct/configurable tones and post-cue capture in synthetic path; wake unvalidated | Unvalidated | Unvalidated | [Desktop activation](desktop-acceptance.md); actual audibility/cue timing required |

## M0–M4 gates

| Gate | Verdict for available setup | Why / remaining work |
| --- | --- | --- |
| M0 Foundation | Passed local hardware-free scope | Locked environments, schemas, typed mock socket exchanges, checks/tests; no claim of a new CI run |
| M1 Audio loop without LLM | Passed synthetic selected silent-sink scope; physical replay unvalidated | Real Whisper/Silero/Piper input/output verification; physical headset/speaker intelligibility still open |
| M2 Conversation core | Passed scripted/fake-clock/socket scope | Follow-up/timeout/expiry/extension/privacy/failure/late cancellation and delivered context; acoustic FR-09 separate |
| M3 Manual daemon | Unvalidated | Actual KDE login/shortcut/lock/mute/device recovery missing; manual mode is permitted, wake is optional and disabled |
| M3 Hands-free | Unvalidated | No detector/model/handoff, no headset/speaker calibration; linked #13 remains open |
| M4 Benchmark/stability release | Unvalidated | Published measurements and reproduction exist; two-hour soak waived by user 2026-10-19; resource/privacy, acoustic/load/quality/fresh-install gaps remain |

## Measured evidence inventory

These numbers summarize committed reports, not new #19 measurements. Reproduce
with exact commands/configuration inventories in each linked report. Measurements
used a 5600X rather than the architecture's nominal 5600.

- [Recognition, 2026-10-17](recognition-comparison.md): 30 distinct clean synthetic
  German/technical utterances, three measured passes. Standard/technical WER:
  Whisper **24.1%/39.3% (failed)**, Parakeet **0.7%/16.7% (passed)**, Vosk
  **5.7%/41.7% (failed)** against ≤15%/≤25% screens. No human/acoustic acceptance;
  Parakeet remains benchmark-only. Corpus, original sentence provenance, hashes,
  complete model artifacts/terms and runtime identities accompany reports.
- [Latency, 2026-10-17](latency-benchmarks.md): 30 warm real-path synthetic queries
  per model, silent monitor signal proxy p50/p95 **770/1007 ms** (Gemma 3 270M
  Q8_0) and **1265/1625 ms** (Llama 3 8B Q4_0). Both pass the signal proxy;
  actual audible p50 ≤1500 ms / p95 ≤3000 ms remains **unvalidated**. Initial Llama
  trial **5249 ms**, disclosed separately. Required-concept scores 6/30 and 11/30
  are insufficient for conversational model selection. No latency target revision
  has been reviewed/approved; original targets remain in force. Future misses
  require explicit evidence and review, never automatic reclassification as passed.
- [Resources](latency-benchmarks.md): active speech average one-core CPU 14.0% /
  12.5%, peak summed RSS 820.2 / 574.9 MiB in those runs. Sampled idle: 0.0%,
  316.5 / 315.9 MiB over three seconds. Separate simultaneous STT/TTS stress:
  396.9% CPU, 640.9 MiB peak RSS, zero dedicated speech VRAM across all 104
  samples. Real active-path unknown VRAM samples (4/1724 and 3/2461) leave
  whole-run VRAM acceptance unvalidated. Ollama/compositor allocation is separate.
- [Offline, 2026-10-19](stability-acceptance.md): loopback-only namespace, no
  external IPv4/IPv6 routes, initial + **30/30** real synthetic voice turns;
  control suites **31.22 s**, voice harness **330.35 s**, exit zero. Concept screen
  **12/30**; one unknown VRAM sample of 3188. This proves disconnected synthetic
  function, not zero attempted external requests, human quality or audibility.
- [Stability, 2026-10-19](stability-acceptance.md): 30 contextual socket turns
  passed; two-hour soak **unvalidated**, stopped at user request. Last checkpoint
  **2640.92 s (44.02 min)**, 45 minute checkpoints, RSS 124.35 MiB initial,
  124.73 MiB peak, 113.39 MiB final, zero idle log bytes at checkpoints. Full CPU
  samples/final verdict not exported; no two-hour, leak-free, heap-erasure or
  queue/buffer occupancy pass.
- [Delivery](delivered-context.md): independent source PCM/silent monitor and
  premature-report negative control verify drained-prefix behavior. Cancellation
  retains complete sentences conservatively, potentially omitting a partly heard
  sentence. It is not word-aligned physical playback proof.

## Separate device support and restrictions

| Setup | Manual activation / voice quality | Spoken stop | Wake | Support claim |
| --- | --- | --- | --- | --- |
| Headset (primary target) | Unvalidated physical acceptance | Unvalidated, off by default | Unvalidated, disabled | Experimental manual path only |
| Speakers | Unvalidated physical acceptance; echo/noise unmeasured | Unvalidated, off by default | Unvalidated, disabled | No acoustic support claim |
| Synthetic monitor / silent sink | Passed integration in named reports | Deterministic/manual cancellation only; not acoustic proof | No detector | Automated evidence only |

Dialect, accents, whisper/noise, prolonged dictation and language switching are
unvalidated; one synthetic probe each does not establish these capabilities.
Production Whisper failed clean synthetic screening. Models and context/output
limits can impair German usefulness; no hallucination/accuracy guarantee is made.
Endpointed STT has no true partials; speech waits for completed generation and
synthesis. General barge-in and validated acoustic echo cancellation are absent.
Mute switches invisible to PulseAudio require separate physical validation.
Capture/output device names/rates, room/gain, kernel/driver, model or runtime
changes require acceptance again; there is no silent device fallback.

Text answers live in current service memory until replacement/closure/privacy
cleanup; session expiry retains context during the extension decision. Terminal
scrollback or deliberate redirection remains outside Jarvis cleanup. No persistent
memory, content logging, cloud fallback, external tools or tray is implied. The
checkout/locked Python setup targets CachyOS x86-64 and tested Python 3.11; no
portable binary/package, broad Linux support or bundled speech/LLM/wake artifacts
are promised. Acquisition/licensing/provenance is listed in the
[installation inventory](installation.md#3-acquire-and-verify-speech-models) and
linked immutable manifests; redistribution needs review, especially voice ancestry,
Piper GPL runtime and the actual LLM terms.

## Documentation revision validation

On the existing checkout, `npm run check` passed TypeScript, Biome, Ruff and both
mypy checks; focused configuration/desktop-runtime tests passed 6/6; full
`npm test` passed **204 Node and 39 Python tests**. Local documentation link
targets and all 25 FR matrix rows were checked. These checks validate software
regressions and document structure, not a fresh account, download availability,
physical devices or release acceptance.

## Remaining validation and release sign-off

- [ ] Execute the [fresh-account procedure](installation.md#fresh-account-acceptance-record)
  on the actual target KDE desktop, including download/hash verification,
  login, shortcut, private permissions, update/rollback and uninstall.
- [ ] Complete [desktop acceptance](desktop-acceptance.md) separately on headset
  and speakers: lock/mute during each active phase, independent inhibitions,
  unplug/replug, backend outage, systemd restart and suspend/resume. Record actual
  capture/output cessation, recovery, text clearing and absence of replay.
- [ ] Complete human German quality/recognizer integration/model selection and
  quiet/noisy/whisper/long/cold/loaded latency scenarios from #16/#17.
- Two-hour idle collection: **waived by the user, 2026-10-19**. Retain the
  44.02-minute partial observation; no two-hour or final CPU pass is claimed.
- [ ] Complete queue/buffer evidence from #18; distinguish blocked network
  access from an external-request attempt audit.
- [ ] Validate [spoken stop](spoken-stop.md) separately for headset/speakers or
  retain an explicit FR-09 gap with manual cancellation for a limited release.
- [ ] Before final hardware acceptance, revisit [#13](../.scratch/jarvis-mvp/issues/13-optional-validated-wake-activation.md)
  again after stable manual physical operation. The #19 source-level feasibility
  revisit is recorded in [wake activation](wake-activation.md#release-feasibility-revisit--2026-10-19).
  No candidate passed the artifact/runtime/German gate; detector/handoff and
  measurements remain follow-up work in #13. Do not close it for manual fallback.
- [ ] Re-run checks/tests at the candidate SHA; attach setup/config/model hashes,
  command outcomes and exact evidence links; classify every requirement for that
  setup. Explicitly review any latency revision and every disclosed gap. Release
  owner records date, candidate SHA, supported device/mode and decision here.

**Current sign-off: withheld.** Documentation can be delivered while hardware
acceptance remains open. Tickets #14/#17/#18 physical evidence, #19 fresh-account
validation and the separate optional #13 follow-up retain their unresolved work.
