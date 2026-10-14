# PRD: Jarvis — Local German Voice Assistant

- **Version:** 0.2 / confirmed product baseline; hardware validation pending
- **Date:** 2026-10-14
- **Status:** Product decisions confirmed in the 2026-10-14 design interview
- **Architecture:** [ADR-0001](./ADR-0001-architecture.md)
- **Terminology:** [Glossary](../GLOSSARY.md)
- **Target platform:** CachyOS, KDE Plasma, PipeWire; Ryzen 5 5600, AMD RX 9070 XT 16 GB VRAM, RAM 32 GB

## 1. Vision

Jarvis is a **local-first, German-language desktop voice assistant** that activates when a user says “Hey Jarvis”, recognizes a question spoken immediately after the wake word, speaks a response, and allows natural follow-up dialogue without repeating the wake word. Sessions terminate by voice command or after an inactivity window. It runs quietly as a per-user background service; a graphical UI is optional rather than a dependency.

The first release serves offline German conversational questions and follow-ups on the user's CachyOS desktop, primarily with a headset. Manual activation is an accepted release mode until hands-free activation passes its own tests. Current information integrations and broad Linux distribution support are deferred; headset and speaker support are reported separately from measured evidence.

Example (offline conversational behavior):

> User: “Hey Jarvis, was ist ein ETF?”
>
> Jarvis: gives a concise German explanation.
>
> User: “Und wie unterscheidet er sich von einer einzelnen Aktie?”
>
> Jarvis: responds in context, no second wake word.
>
> User: “Danke Jarvis, das war's.”
>
> Jarvis: ends the session and returns to activation readiness.

## 2. Goals and priorities

1. **Local and private by default:** on-device speech and inference, no audio uploads or automatic cloud fallback.
2. **Responsive conversations:** prioritize first audible response and quick follow-up handling, measure rather than assume latency.
3. **Low GPU footprint:** speech processing uses CPU by default, preserves GPU VRAM for Ollama.
4. **Reliable desktop operation:** automatic user-session startup, graceful failure recovery and device hotplug.
5. **German quality:** reliable recognition, German punctuation and intelligible natural German synthesis.
6. **Modularity:** models, audio devices, LLMs, and tool adapters are replaceable without redesigning sessions.

## 3. Personas / use cases

- Developer working in KDE/CachyOS, wants hands-free short questions while other programs are in focus.
- Hands-free follow-ups about a topic without reactivating the assistant every turn.
- Optional future integrations: live stock data, weather, Home Assistant, and desktop actions, with explicit permission boundaries.

## 4. Scope

### MVP (P0)

- Headless user-session background operation via systemd user units.
- Manual activation by one shortcut press or CLI trigger, with automatic silence endpointing; no held key required. Validated, properly licensed German-capable “Hey Jarvis” activation is an optional release mode with a separate hands-free gate.
- Single-utterance command directly after wake phrase, including pre-roll to avoid truncation.
- German STT and German TTS, permanently loaded for warm interaction.
- A local Ollama endpoint with streamed generation; configured model switchable.
- Conversation history kept per active session; follow-up question detection without wake word.
- Configurable 20-second follow-up window, started **after audio playback ends**.
- Explicit end phrases: “Danke Jarvis, das war's”, “Gespräch beenden”, “Gute Nacht Jarvis”.
- Explicit “Stopp” during speech must immediately stop playback (it need not end session).
- Configurable microphone/output, sensible fallback when devices disappear.
- No raw audio/transcript retention by default.
- Status and health via CLI and structured, content-free logs.
- Clear error messages and cancellation handling for unavailable STT/TTS/Ollama.
- Configurable activation and distinct conversation-end sounds, enabled by default; manual listening begins after the activation sound finishes.
- Lock/mute stops capture and playback, cancels work, and clears the conversation; unlock/unmute restores activation readiness without resuming work.
- Configurable five-minute conversation allowance, finished-turn expiry, and explicit extension.
- Concise German spoken replies, more detail on request, and explicit temporary CLI access to text answers, including code/tables summarized in speech.

### Next (P1)

- Genuine full-duplex barge-in with speaker echo suppression, validated against false interruptions.
- Sentence- or chunk-based early TTS from streamed LLM output; avoid speaking unfinished markdown/code.
- KDE Plasma tray icon with mute / active / working indicators and quick controls.
- Explicitly enabled read-only data tools (e.g. market quotes) with source/timestamp; ask permission on first enablement.
- Easy German-voice model picker and benchmark utility.

### Future (P2)

- Optional persistent, user-controlled memory.
- Multiple speakers, voice profiles, optional person recognition only with opt-in.
- Integrations with desktop applications/Home Assistant.
- Multi-language support and cross-device clients.
- Custom acoustic model training pipeline and calibration UI.

### Out of scope for MVP

- Financial trades, automated purchases or irreversible actions.
- Always-on transcription or ambient conversation recording.
- Voice biometrics/identity verification.
- Cloud LLM/STT/TTS fallback.
- Distributed multi-machine operation or root-level services.
- Guaranteed perfect wake detection and perfect speaker barge-in.
- Promised dialect support, prolonged dictation, language switching, or broad Linux distribution support.

## 5. Functional requirements and acceptance criteria

| ID | Requirement | Testable acceptance criterion | Priority |
|---|---|---|---|
| FR-01 | Start at login | After login, services become ready without opening any application; no root privileges required | P0 |
| FR-02 | Idle privacy | Unlocked/unmuted idle permits wake detection and bounded, overwritten in-memory pre-roll; no STT/LLM call or persistent recording | P0 |
| FR-03 | Activation + utterance | Manual activation captures the utterance after acknowledgment; when wake mode is enabled, “Hey Jarvis, [question]” retains the immediate command without clipping in the defined test set. Manual and hands-free results reported separately | P0 |
| FR-04 | German STT | A fixed corpus of ≥30 German utterances including common English technical terms produces measurable errors; benchmark and quality gate documented | P0 |
| FR-05 | Spoken response | Each successful answer has an intelligible German Piper spoken form offline; code/large tables receive a summary with deliberate text access | P0 |
| FR-06 | Follow-up context | User asks a follow-up within 20 s after playback and gets answer informed by previous exchange without new wake word | P0 |
| FR-07 | Timeout | 20 s without meaningful speech after playback completes/stops closes the session; recognition already in progress has a documented bounded completion allowance, and noise/empty results cannot renew the deadline | P0 |
| FR-08 | Explicit end | “Danke Jarvis, das war's” ends current session and clears transient conversation context | P0 |
| FR-09 | Stop playback | Standalone spoken “Stopp” promptly stops playback without closing the session and opens follow-up; manual cancel remains available. Voice stop tested independently on headset and speakers; manual-only cancel does not pass the voice criterion | P0 |
| FR-10 | Resilience | Disconnect/reconnect mic or suspend/resume does not permanently kill service; recover or show degraded state | P0 |
| FR-11 | Resource policy | Default speech stack uses CPU; no dedicated GPU VRAM allocated by speech inference in standard setup | P0 |
| FR-12 | Configuration | Model identifiers, device IDs, timer, endpoint, session token cap exposed via config with documented defaults | P0 |
| FR-13 | Logging/privacy | Default logs contain status/timing/errors but no raw audio, transcribed text or prompts | P0 |
| FR-14 | Tool isolation | No autonomous shell/network/financial action unless corresponding adapter explicitly enabled and authorized | P0 |
| FR-15 | Barge-in | User interrupting spoken reply can redirect conversation; TTS cannot self-trigger false turn in representative speaker tests | P1 |
| FR-16 | Early speech | First complete sentence can begin playing before entire LLM response is generated | P1 |
| FR-17 | Tray | Tray displays idle/listening/thinking/speaking/muted and can mute/stop | P1 |
| FR-18 | Finance tool | When enabled, fresh quotes disclose source/time, and unavailable/stale quotes are not described as current | P1 |
| FR-19 | Lock/mute privacy | Lock or mute immediately stops capture/playback, cancels work and clears context; clearing one inhibition cannot override another; no automatic conversation resumption | P0 |
| FR-20 | Manual replacement | Activation during thinking/speaking cancels current work and listens after acknowledgment; late canceled results are ignored | P0 |
| FR-21 | Delivered context | Follow-ups retain completed exchanges and delivered speech only; unheard remainders and unanswered canceled questions are excluded | P0 |
| FR-22 | Expiry/extension | At five minutes finish the current turn, prompt for extension, then accept only extension/end for 20 s; “Weiter” grants five more minutes with context; silence closes | P0 |
| FR-23 | Text answer | Explicit CLI option displays the current session's answer without persistence or routine content logging; session closure clears access | P0 |
| FR-24 | Capability health | CLI distinguishes manual activation available from voice conversation unavailable; failures do not cause automatic question replay or repeated audible idle errors | P0 |
| FR-25 | Audible readiness | Default activation/end sounds are distinct and configurable; manual listening starts after activation sound; wake acknowledgment never discards the immediate command | P0 |

## 6. Conversation rules

- Default post-answer follow-up: **20 seconds**; configurable 5–60 seconds.
- Timer begins when playback completes or is stopped, never at speech recognition completion.
- General follow-up listening begins after playback ends in MVP; independently validated voice stop can process bounded microphone input during playback. General voice barge-in remains P1.
- Speech detection permits bounded completion of recognition. If the result is noise/empty, the original deadline applies; no fresh window is granted. Document the recognition allowance and validate its bound. A valid new turn gets its next window after its reply finishes.
- Match a small deterministic set of standalone voice control phrases, not substrings or LLM interpretations. “Was bedeutet Stopp auf Englisch?” remains a question. “Stopp” cancels the current spoken reply and opens follow-up; the documented end phrases close the session.
- Single-press manual activation during thinking/speaking cancels the operation and starts listening after acknowledgment. Exclude unanswered canceled questions from future context; retain earlier completed exchanges and the delivered portion of any interrupted reply. Ignore late canceled results.
- Default conversation allowance **five minutes**. On expiry finish the current turn, then briefly ask whether to continue. During a **20-second** window after that prompt, accept only explicit extension/end commands. “Weiter” renews the allowance by five minutes with existing context; silence closes. Expiry between turns prompts immediately. Separate stalled-operation watchdogs may interrupt work.
- For malformed/empty utterances, return to follow-up under the original deadline or close when it has expired; do not automatically replay questions or enter an endless recognition loop.
- Outside an active session, audio is never sent to STT even if wake detector runs continuously.
- On session closure, clear temporary audio and session conversation buffer unless persistent memory is explicitly enabled in future.
- Lock or mute immediately stops capture/playback, cancels recognition/generation, and closes the session. Unlock/unmute restores wake detection or manual readiness only when no inhibition remains; no old conversation resumes.
- After an active-turn failure give one brief error indication where possible and preserve context while the session remains open. Require “Noch einmal” or a new question before another attempt; recovered services do not automatically replay work.
- Speak concise German by default and expand on request. Summarize code/large tables and indicate the explicit CLI text option. Generated but unheard reply remainders are not part of follow-up context.

## 7. Nonfunctional requirements

**Performance (initial targets; measure on target machine):**

- Warm (models loaded), short local query, no network tool call: p50 user-speech-end → audible reply ≤ 1.5 s; p95 ≤ 3 s, measured over ≥30 samples and reported with model/configuration details. Not an unconditional product guarantee.
- Wake-to-listening transition should be perceptually immediate; record latency and clipping rate.
- Speech stack GPU allocation target: **0 MB** dedicated inference VRAM; LLM may use GPU.
- RAM and CPU baselines must be measured at idle and during concurrent STT/TTS; do not set fictional absolute ceilings before benchmarking.
- Choose initial speech/LLM models by comparing German accuracy, conversational usefulness, and measured latency. Targets may be revised with documented evidence and review; a missed target is never reported as passed.

**Reliability:** self-recover from model startup failures or audio backend reconnects; no unbounded log growth; watchdog detects lost audio loop; tests include 2h idle soak and resume from suspend.

**Privacy/security:** local-only inference default; user-session permissions; Unix socket 0600 or equivalent directory access restrictions; configurable network tool allowlist; logs free of personal audio/transcripts; offline mode test with network disconnected.

**Accessibility/UX:** distinct activation/end sounds enabled by default and configurable; concise spoken replies and deliberate temporary text access; hardware mute must be respected. Conversational German and common English technical terms are the MVP scope; dialects, prolonged dictation, and language switching are measured rather than promised.

**Maintainability:** typed TypeScript protocol/event schemas, Python type hints, unit/integration tests, pinned dependencies and model checksums; documentation describes model licensing and provenance.

## 8. Default configuration (illustrative)

```yaml
locale: de-DE
audio:
  input_device: default
  output_device: default
  sample_rate_hz: 16000 # internal STT format; output resampled to voice/device rate
  pre_roll_ms: 750
  echo_cancellation: false # opt-in until speaker calibration
wake_word:
  phrase: "Hey Jarvis"
  model_path: null # no unverified model bundled; manual activation fallback
  threshold: null # calibrate per model and microphone
vad:
  engine: silero
  end_silence_ms: 350
  max_utterance_seconds: 30
stt:
  engine: sherpa-onnx
  model: to-be-benchmarked
  device: cpu
tts:
  engine: piper
  voice: de_DE-thorsten-medium
  device: cpu
llm:
  provider: ollama
  base_url: http://127.0.0.1:11434
  model: user-configured
  max_context_tokens: 8192
session:
  follow_up_seconds: 20
  max_duration_seconds: 300
  extension_response_seconds: 20
  extension_duration_seconds: 300
  persistence: false
interaction:
  manual_activation: single_press
  activation_sound: true
  conversation_end_sound: true
features:
  barge_in: false
  external_tools: false
  tray: false
logging:
  content_logging: false
```

The configuration must undergo schema validation; all model choices and thresholds are provisional until tested. Internal audio format may differ from capture/playback rates; resampling must be explicit.

## 9. Delivery plan for Codex

### Milestone M0 — Project foundation

- Monorepo layout `apps/core`, `apps/audio`, `packages/protocol`, `systemd`, `docs`, `tests`.
- TypeScript build/lint/test; Python `pyproject.toml` with lockfile; environment diagnostics CLI; config schema; model manifest; architecture docs.
- **Exit gate:** tests pass in CI/local; service mock can exchange typed events over Unix socket; no hardware needed.

### Milestone M1 — Audio loop without LLM

- Audio input/output and device discovery; bounded pre-roll; Silero VAD; Piper German TTS; STT adapter interface with CPU backend; offline fixture test.
- **Exit gate:** transcribe predefined German recording, synthesize response, replay through selected device; log latency but not content.

### Milestone M2 — Conversation core

- State machine, cancellable tasks, Ollama streaming integration, delivered-reply context, follow-up/extension timers, deterministic voice controls, manual replacement, temporary CLI text access; mock adapters for deterministic unit tests.
- **Exit gate:** scripted manual/wake activation → listen → think → speak → follow-up → listen → timeout → idle; fake-clock tests cover empty/noise deadlines, expiry/extension, lock/mute, failures, and late canceled results. Acoustic voice-stop acceptance remains a separate hardware test.

### Milestone M3 — Wake word + daemon

- Single-press KDE shortcut/CLI activation, acknowledgment timing, optional validated wake-word model and prefix/command split; systemd user units, lock/mute inhibition, capability health, device recovery.
- **Exit gate:** login starts services; manual activation works on target hardware; no transcription while idle and no capture while locked/muted. Manual-only mode can pass this gate. Hands-free mode has a separate gate for “Hey Jarvis, [question]”, clipping, recall and false accepts; unvalidated wake mode is not enabled by default.

### Milestone M4 — Benchmark and stability release

- Compare STT engines and local LLM configurations on German/technical vocabulary; capture p50/p95 latency; idle CPU/RAM and GPU allocation; 2h idle soak; suspend/resume; 30-turn follow-up test; no-network test; separate headset/speaker voice-stop and activation results.
- **Exit gate:** published reproducible measurements, regression baseline, documented gaps; no invented claims.

### Milestone M5 — Optional natural-conversation enhancements (P1)

- PipeWire echo cancellation; full-duplex barge-in; streaming sentence-to-Piper; optional tray and read-only approved data tools.
- **Exit gate:** barge-in works with headset and speakers, no replay self-trigger in reference test set; safe tool-use tests pass.

## 10. Testing strategy

- **Unit:** state transitions, fake timers, standalone commands vs quoted words, stop/end/replacement semantics, delivered context, noise deadlines, extension-only listening, lock/mute cleanup, late-result cancellation, response segmentation, policy checks.
- **Contract:** versioned protocol and cancellation, reconnect, bounded queue tests.
- **Integration:** recorded German audio fixtures (consented or synthetic), real Piper/recognizer adapters, Ollama fake server for repeatable tests.
- **Hardware acceptance:** microphone + speakers and headset, noise/TV/music, start-with-command, false-wake test over representative duration, lost microphone, TTS self-feedback, long silence, service restart, GPU load, suspend/resume.
- **Performance:** automatically capture end-to-end timestamps and compute p50/p95; note audio device, model revision, quantization, CPU/GPU state.

## 11. Open risks / decisions requiring validation

1. Which German wake-word ONNX model achieves acceptable recall and false accepts in the target room? Avoid assuming general English openWakeWord pretrained weights work for German.
2. Does Parakeet TDT v3 INT8 on Ryzen 5 5600 meet p95 target, or should true-streaming Vosk/sherpa-onnx alternative be preferred?
3. Does PipeWire echo cancellation adequately support barge-in through typical loudspeakers? If not, disable speaker barge-in and keep headset/manual fallback.
4. Which actual local Ollama model, quantization and context yield acceptable first-token latency and quality on 16 GB VRAM?
5. Which KDE shortcut/CLI mechanism reliably implements the agreed single-press activation and lock/mute behavior? The interaction is settled; integration requires verification.
6. Which read-only market data provider, with what authentication/licensing/delay disclosures, will be used once external tools are enabled?
7. Can bounded voice-stop processing reliably recognize standalone “Stopp” during playback without false stops or general barge-in, separately on headset and speakers?
8. What bounded recognition-completion allowance and delivered-speech tracking precision are reliable on the selected adapters? Document and test these implementation limits.

## 12. Definition of Done for MVP

M0–M4 gates passed for the documented activation mode on the target CachyOS desktop; reproducible clean install/run instructions; useful offline German questions and follow-ups; config, health, and logs documented; benchmark evidence and known restrictions published. Manual activation can satisfy the MVP activation requirement without a validated wake model. Headset is the primary acceptance setup; speaker results are reported separately.

The release checklist records **passed**, **failed**, or **unvalidated** for each requirement and its relevant test setup. Local inference, idle privacy, bounded capture, and cancellation are mandatory. A useful release may carry disclosed gaps, including unreliable voice stop, but must not claim all P0 requirements passed. FR-09 requires evidence for spoken stop; manual cancellation alone is insufficient. Latency targets are reviewed against measured evidence and may be revised transparently. Hands-free activation is claimed only after its separate gate passes.

## 13. Suggested first Codex instruction

```text
Read docs/ADR-0001-architecture.md and docs/PRD-jarvis.md completely.
Implement Milestone M0 only. Do not implement speculative model integrations, external data tools or barge-in yet.
Start by proposing a concise file tree and plan. Then create the minimal runnable monorepo, typed event protocol, config validation, Python and TypeScript skeletons, a mock Unix-socket handshake, unit/contract tests and development scripts. Use deterministic mocks and a fake clock. Keep all networking local. Include exact commands to install, run, test, and inspect both services. Mark decisions needing hardware validation in README; do not claim measured performance.
```
