# Configuration and model records

Both services validate the same Draft 7 JSON schema at
`packages/protocol/schemas/config.schema.json` and apply its defaults before
starting. They read `$JARVIS_CONFIG` when set, otherwise
`${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml`. An absent default file
uses defaults; an explicitly configured missing file is an error. Files over
64 KiB, malformed YAML, duplicate mapping keys, incorrect types, unknown keys and unsupported settings
are errors. Diagnostics name a schema location and constraint without echoing
its value. Both services use YAML 1.2 scalar resolution: `on`/`off` are strings,
and a leading zero does not make a decimal integer octal (`01000` means 1000).
Use YAML `true`/`false` for boolean settings.

`config/defaults.json` is the complete default configuration and can be copied
directly to `config.yaml`: JSON is valid YAML. `node dist/apps/core/main.js config`
prints deliberately requested configuration, while routine logs never print it.

| Group | Defaults and limits |
| --- | --- |
| Locale | `de-DE` |
| Devices | Input/output `default`; stable device identifiers can be configured but are unused by mocks |
| Internal audio | 16000 Hz mono recognition format reserved; pre-roll 750 ms (500–1000); echo cancellation disabled |
| Wake | `Hey Jarvis`, model path/threshold `null`; unverified wake models rejected in M0 |
| VAD | `silero`; end silence 350 ms (50–5000); max utterance 30 s (1–120) |
| Recognition | `sherpa-onnx`, `to-be-benchmarked`, CPU; no recognizer loaded |
| Synthesis | `piper`, `de_DE-thorsten-medium`, CPU; `model_path` defaults to `models/de_DE-thorsten-medium.onnx`; loaded only in `audio.mode: piper` |
| LLM | `ollama`, `http://127.0.0.1:11434`, `user-configured`; context 8192 tokens (512–32768); no real inference requested |
| Local endpoint | Only HTTP with literal `127.0.0.1`, `localhost`, or `[::1]` plus a port 1–65535; credentials and remote endpoints rejected |
| Session | Follow-up 20 s (5–60), duration 300 s (30–3600), extension response 20 s (5–60), extension duration 300 s (30–3600) |
| Recognition allowance | 5 s (1–30) beyond the original follow-up deadline for speech begun before it; also bounded by max utterance from onset; acoustic validation pending |
| Interaction | Single-press activation; activation and conversation-end sounds enabled; acknowledgment completion simulated by mocks; no audible sounds |
| Disabled features | Barge-in, external tools, tray, persistence and content logging must remain false in M0 |
| Transport | Deadline 1000 ms (100–10000), frame 8192 bytes (1024–65536), connections 8 (1–32) |

Manual mock turns use activation/end sound flags, utterance/context limits, follow-up, recognition allowance, conversation duration and extension timers (see README). Playback has a separate 120-second watchdog; other service operations use the transport deadline.
The conversation allowance starts at activation and does not restart on normal
follow-ups or manual replacement. Its default is five minutes. Healthy turns
finish after expiry; between turns Jarvis prompts immediately. The extension
response window starts after the prompt is fully delivered. Only standalone
`Weiter` or an end phrase is accepted in that window; other speech neither
invokes inference nor renews the deadline. `Weiter` starts a fresh extension
allowance from the command and preserves delivered context. Silence clears it.
The response deadline is strict, including recognition completion: speech onset
near its end does not add the normal follow-up recognition allowance. A renewal
opens the normal follow-up window; inactivity can therefore close the conversation
before the renewed duration allowance is used up. Prompt synthesis and playback
have the same independent stalled-operation watchdogs as other turns.
Other settings reserve the agreed product configuration; they do not make
unimplemented capabilities available. Speech thresholds, sound behavior, German
quality, device rates, delivered speech precision and CPU/RAM/VRAM/latency are
unvalidated until the later hardware milestones.

`config/models.json` pins the provisional Thorsten medium model and configuration; see [real output](audio-output.md). Its linked schema requires
an exact revision, SHA-256, license, original source URL, provenance, local path,
role and validation flag for every future model record. Record each downloaded
artifact separately. No models are bundled, and entries alone never enable a model. Later model installation must
verify checksums, licensing and provenance before enabling any speech engine.

Failure recovery uses `recovery.probe_interval_ms` (2000 ms, range 500–30000)
for audio health probes; probes in the same privacy/audio generation share one
request. A new privacy generation can issue a fresh probe without waiting for an
obsolete one. Old replies cannot change current readiness. Each request still
has the transport deadline. `recovery.playback_timeout_ms` (120000 ms, range
1000–300000) bounds playback independently of conversation expiry. Recognition
uses the utterance/completion limits; inference, synthesis, acknowledgment,
cancellation and the failure cue use `transport.timeout_ms` in mock mode. In Piper mode synthesis, acknowledgment, end/failure sounds and playback use the playback watchdog.

A stalled inference/synthesis/playback requests cancellation and, after its
acknowledgment, one failure cue. Stalled cancellation or cue degrades audio
health instead of retrying cleanup forever. Audio loss preserves completed
context and the unsuccessful question in memory only until follow-up expiry;
repeated failed probes do not extend that deadline. Lock/mute and conversation
closure still clear everything. Real model/device watchdogs are unvalidated.
