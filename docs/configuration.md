# M0 configuration and model records

Both services validate the same Draft 7 JSON schema at
`packages/protocol/schemas/config.schema.json` and apply its defaults before
starting. They read `$JARVIS_CONFIG` when set, otherwise
`${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml`. An absent default file
uses defaults; an explicitly configured missing file is an error. Files over
64 KiB, malformed YAML, duplicate mapping keys, incorrect types, unknown keys and unsupported settings
are errors. Diagnostics name a schema location and constraint without echoing
its value. Use YAML `true`/`false`, decimal integers and strings for portability.

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
| Synthesis | `piper`, `de_DE-thorsten-medium`, CPU; no voice loaded |
| LLM | `ollama`, `http://127.0.0.1:11434`, `user-configured`; context 8192 tokens (512–32768); no inference requested |
| Local endpoint | Only HTTP with literal `127.0.0.1`, `localhost`, or `[::1]` plus a port 1–65535; credentials and remote endpoints rejected |
| Session | Follow-up 20 s (5–60), duration 300 s (30–3600), extension response 20 s (5–60), extension duration 300 s (30–3600) |
| Recognition allowance | 5 s (1–30), provisional and unused in M0; requires later adapter validation |
| Interaction | Single-press activation; activation and conversation-end sounds enabled; no sounds played by mocks |
| Disabled features | Barge-in, external tools, tray, persistence and content logging must remain false in M0 |
| Transport | Deadline 1000 ms (100–10000), frame 8192 bytes (1024–65536), connections 8 (1–32) |

These settings reserve the agreed product configuration; they do not make
unimplemented capabilities available. Speech thresholds, sound behavior, German
quality, device rates, delivered speech precision and CPU/RAM/VRAM/latency are
unvalidated until the later hardware milestones.

`config/models.json` starts with an empty model list. Its linked schema requires
an exact revision, SHA-256, license, original source URL, provenance, local path,
role and validation flag for every future model record. Record each downloaded
artifact separately. No download/install code exists, no unverified models are
bundled, and entries alone never enable a model. Later model installation must
verify checksums, licensing and provenance before enabling any speech engine.
