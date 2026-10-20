# Jarvis MVP implementation map

- [27: Existing llama.cpp server](issues/27-llama-cpp-inference-adapter.md#answer) — implementation and live API/headset runtime checks delivered; human quality assessment and #17 full matrix remain separate. [Evidence](llama-cpp-acceptance-2026-10-20.md).

- [01: Runnable mock services and health](issues/01-runnable-mock-services-and-health.md#answer) — resolved; M0 foundation implemented and all local checks pass.
- [02: Manual activation with scripted answer](issues/02-manual-activation-scripted-answer.md) — resolved; scripted turn and delivery checks pass.
- [03: Contextual follow-ups and explicit ending](issues/03-contextual-follow-ups-and-ending.md#answer) — resolved; fake-clock and socket checks pass.
- [04: Manual replacement and delivered context](issues/04-manual-replacement-delivered-context.md#answer) — resolved; cancellation, delivery-context and CLI checks pass.
- [05: Conversation expiry and extension](issues/05-conversation-expiry-and-extension.md#answer) — resolved; fake-clock expiry/extension and daemon/Python socket checks pass.
- [06: Lock and mute privacy](issues/06-lock-and-mute-privacy.md#answer) — resolved; independent inhibition, cleanup and socket checks pass.
- [07: Failure, retry and capability recovery](issues/07-failure-retry-capability-recovery.md#answer) — resolved; explicit retry, capability health, bounded socket recovery and diagnostics implemented.
- [08: Real German synthesis and playback](issues/08-german-synthesis-and-playback.md#answer) — resolved; pinned CPU Piper output, stable sink selection, resampling, drained completion and cancellation verified on a silent PipeWire sink.
- [09: Manual microphone question and scripted spoken reply](issues/09-microphone-question-scripted-reply.md#answer) — resolved; optional PipeWire capture, CPU Silero/Whisper, privacy cancellation, and real synthetic German core/socket/playback checks pass; hardware accuracy remains unvalidated.
- [10: Local Ollama voice conversations](issues/10-local-ollama-voice-conversations.md#answer) — resolved; streamed loopback generation, automatic bounded microphone follow-ups, cancellation, retry and capability health verified with fake services; real Ollama adapter check passed, full speech/hardware smoke remains unvalidated.
- [11: Concise speech and temporary text answers](issues/11-concise-speech-temporary-text.md#answer) — resolved; German style instructions, Markdown-aware summaries, frame-bounded CLI text access, delivered-only context and privacy cleanup verified; all review findings resolved; final checks and 176 Node/9 Python tests pass.
- [12: Login startup, KDE activation, and device recovery](issues/12-login-kde-device-recovery.md#answer) — implementation complete; user units, real desktop inhibition/recovery and lifecycle docs added; 182 Node/9 Python tests pass; follow-up bounded-work and XDG installation review findings resolved. Target KDE/hardware acceptance remains unvalidated and M3 stays open.
- [13: Experimental wake activation enabled by default](issues/13-optional-validated-wake-activation.md#answer--experimental-default-on-implementation-2026-10-20) — implementation complete; pinned resident CPU wake at 0.2, explicit disable/manual fallback, continuous bounded handoff, privacy/cancellation and daemon/audio socket tests. User accepts measured 23/30 (76.7%) recall as experimental; full acoustic/desktop/release acceptance stays open separately.
- [14: Spoken stop and acoustic acceptance](issues/14-spoken-stop-acoustic-acceptance.md#answer) — implementation complete; opt-in bounded resident control recognition, conservative echo guards, socket cancellation and sentence-prefix delivery tracking; standards/spec code findings resolved, including disconnect delivery retention and closure waveform release; 188 Node/18 Python tests pass. **Ready for human:** actual headset and speaker FR-09 acoustic trials remain unvalidated; voice stop defaults off.
- [15: Real playback delivery in follow-up context](issues/15-real-delivered-reply-context.md#answer) — resolved; next fake Ollama requests verify delivered-only context and stale/privacy handling; real Piper/Pulse interruption probe with independent silent-sink monitor passed. Sentence precision measured and documented; physical headset/speaker demo remains unvalidated. 203 Node/21 Python tests pass; review follow-up replaced circular baseline evidence with independent source PCM and frozen report-time capture, and rejects a real premature-report negative control.
- [16: German recognition comparison](issues/16-german-recognition-comparison.md#answer) — resolved; reproducible 30-utterance synthetic CPU comparison plus capability probes; Parakeet v3 INT8 passes the screening gate, Whisper/Vosk fail quality; production integration and acoustic acceptance remain unvalidated.
- [17: End-to-end latency and resource benchmarks](issues/17-latency-and-resource-benchmarks.md#answer) — implementation and synthetic baseline delivered; 30 real-path silent-sink queries per local LLM, content-free traces, regression command and separate idle/concurrent speech resource measurements published. **Ready for human:** physical audibility, German quality ratings and remaining acoustic/load scenarios; proxy passes do not close the audible target gate.
- [18: Offline and desktop stability acceptance](issues/18-offline-desktop-stability.md) — **closed for delivered implementation/tooling**, including reviewed capture occupancy evidence and fixes through `ee483ce`; 211 Node / 65 Python tests pass. Remaining physical/privacy/network/native-buffer evidence carried to #12/#17/#19, explicitly unvalidated. Two-hour duration waived; 44.02-minute observation partial.
- [19: Reproducible installation and release checklist](issues/19-installation-and-release-checklist.md#answer) — documentation delivered; consolidated installation/lifecycle/model inventory and FR-01–FR-25/M0–M4 evidence matrix. **Ready for human:** fresh-account target-desktop installation and release acceptance; mandatory hardware gates remain unvalidated, no MVP release claimed. #13 feasibility revisited at source level, actual candidate/runtime/German trials remain open.
- [20: Production Parakeet recognition](issues/20-production-parakeet-recognition.md#answer) — resolved; selectable pinned CPU recognizer, synthetic production path, cancellation/privacy and error checks passed; human headset quality/latency handed to #17.
- [21: Separate speaker acceptance](issues/21-speaker-acceptance.md) — ready-for-human after stable headset operation; independent support verdict, not a headset-release blocker.
- [23: Long spoken answers fail at the duration limit](issues/23-long-speech-duration-overflow.md#answer) — resolved; bounded prefix/notice speech, full temporary text and delivered-only context; 208 Node/43 Python tests, both review axes, real Piper PCM-boundary probe and actual headset rerun pass.
- [24: Jieli hardware-mute detection](issues/24-jieli-hardware-mute-detection.md#answer) — resolved as unsupported/wontfix for this device/configuration; actual held-switch checks found unchanged ALSA/source mute and no HID/event interface. Development use only; #12/FR-19 hardware privacy release gate stays open. [Evidence](hardware-mute-2026-10-20.md).
- [25: Audio restart resumes capture](issues/25-audio-restart-resumes-capture.md#answer) — resolved; recovery and timer expiry wait for deliberate activation, 206 Node/42 Python tests and both reviews pass; actual playback/audio-crash headset rerun confirms readiness without resumed capture or answer. Other #12 gates remain open.

## Remaining work order — 2026-10-19

- [27: llama.cpp inference adapter](issues/27-llama-cpp-inference-adapter.md) — ready-for-agent, unclaimed; add a configurable local llama-server backend alongside Ollama, including streaming, readiness, cancellation and live integration evidence. Requested for later implementation; current #17 setup unchanged.

**Current next task — 2026-10-20:** #17 physical headset acceptance. #18
instrumentation and review fixes are delivered; #20 and #13 implementation are
delivered. The historical sequence below retains earlier acceptance dependencies.

This plan supersedes historical queue hints above, not their evidence. Delivered
comparison #16 is complete; its remaining production work is #20. #12 is now
ready-for-human. Status describes who can do remaining work; dependencies below
determine when it can begin. Do not treat old ready-for-agent labels on delivered
tickets as a fresh implementation queue.

| Order | Ticket / outcome | Dependency and shared work |
| --- | --- | --- |
| 1 | #20 Production Parakeet | Next unblocked agent implementation; no hardware pass claimed |
| 2 | #17 Headset acceptance and model selection | After #20; start with a short human trial, fix failures, then complete quality/latency scenarios |
| 3 | #12 Desktop privacy and recovery | Can prepare/run independently; final evidence uses #17's selected setup; share results with #18/#19 |
| 4 | #18 Stability and privacy evidence | Tooling can proceed independently; final acceptance incorporates #12/#17; two-hour idle run waived by user 2026-10-19, 44.02-minute partial observation retained; queue/buffer and privacy checks remain |
| 5 | #19 Fresh installation and release decision | After #12/#17/#18 on the settled candidate; review all gaps explicitly |
| Separate | #13 Wake, #14 spoken stop, #21 speakers | Independent outcomes; share trials where useful; #13 feasibility revisit required before sign-off, successful wake/speaker validation optional for a manual headset release; FR-09 gap must remain disclosed |

Run related checks in one session and link the same evidence from every affected
ticket. Record candidate SHA/config/models/devices and setup-specific verdicts.
Create focused bug tickets when testing exposes failures; repeat affected checks
after fixes. No acceptance criterion is silently dropped by grouping sessions.
No runtime changes, hardware acceptance or release sign-off is claimed by this plan.


## Wake candidate follow-up — 2026-10-20

#13 now has a reproducible offline CPU candidate evaluator and an explicitly
started headset calibration recorder. The default synthetic screen yields 0/30
wakes and 9 false activations; exploratory threshold 0.01 yields 30/30 but 29
false activations. No approved threshold or production handoff is delivered.
User-requested physical calibration is prepared, not executed; #13 and its #17
prerequisite remain open. See [#13 follow-up](issues/13-optional-validated-wake-activation.md)
and [evaluation procedure](../../docs/wake-activation.md#offline-candidate-evaluation--2026-10-20).

## #18 scoped delivery — 2026-10-20

Production buffer instrumentation and finite fixture evidence are delivered; this
supersedes earlier wording naming #18 instrumentation as the next agent task.
See [the scoped outcome](issues/18-offline-desktop-stability.md#buffer-occupancy-instrumentation-delivered--2026-10-20)
and [evidence/method](../../docs/capture-buffer-evidence.md). Remaining #18 work
requires physical/privacy/network acceptance; no release gate is closed here.

## Next task: #17 — user decision, 2026-10-20

Headset trial exposed [#26: wake with an integrated question](issues/26-wake-integrated-question.md).
Claimed for diagnosis before continuing the full #17 matrix; no headset wake
handoff pass is claimed.

#18 is closed for delivered implementation/tooling through `ee483ce`; outstanding
acceptance gaps are carried by #12/#17/#19. This supersedes the earlier #18 next-task
wording. Begin #17 with a short physical headset conversation, then proceed to
model/quality/latency comparisons. [Fresh-context handoff](headset-acceptance-handoff.md).
