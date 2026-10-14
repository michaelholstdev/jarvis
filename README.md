# Jarvis — scripted mock conversations

A Node.js/TypeScript core and a separate Python audio service exchange validated
messages over private Unix sockets. No microphone, speaker, speech model,
Ollama, cloud fallback or external tool is needed. This milestone verifies the
runnable foundation. Real German voice conversation is **unavailable**; scripted manual activation
is available as a mock; a successful health check means only the mock services are ready.

Layout: `apps/core` (CLI and orchestration), `apps/audio` (Python mock),
`packages/protocol` (shared schemas/types), `config` (defaults and model records),
`tests` (hardware-free checks), `systemd` (future deployment notes).

Prerequisites: Linux with Unix sockets, Node.js >=22 (tested with 24), npm,
Python >=3.10 (project environment tested with 3.11), and uv (tested with
0.9.21). On CachyOS install runtimes with `sudo pacman -S nodejs npm python uv`.
Do not run Jarvis itself as root. Dependency installation needs package registry
access; installed mocks require no internet access. PipeWire and KDE are future
hardware integration requirements, not M0 runtime dependencies.

From the repository root:

```sh
node --version
python3 --version
uv --version
npm ci
uv sync --frozen
npm run build
npm run doctor
```

`uv sync` creates the project `.venv`; activation is unnecessary. `package-lock.json`
and `uv.lock` pin dependencies. Keep the repository's `packages` and `config`
directories with `dist`, since compiled services load shared schema assets there.
The doctor reports missing/unsupported runtimes, missing dependency environments,
missing build and missing runtime directory, with a nonzero exit code.

Configure:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis"
cp config/defaults.json "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml"
node dist/apps/core/main.js config
```

Both processes use the XDG configuration by default; an optional `JARVIS_CONFIG`
environment variable selects another YAML file. Set it identically in both
terminals. Full [configuration defaults and limits](docs/configuration.md) and
the [protocol contract](docs/protocol.md) are documented separately.

Start audio in terminal 1:

```sh
.venv/bin/python apps/audio/main.py
```

Start core in terminal 2:

```sh
npm run core
```

Each prints `service_started` after opening its socket. The core can start
without audio and reports degraded health until the next successful handshake.
In terminal 3 inspect health (direct CLI gives machine-readable JSON):

```sh
node dist/apps/core/main.js health
```

Exit code 0 means both mock services completed the handshake; exit code 1 means
degraded/unavailable, an invalid configuration or a protocol failure. Output distinguishes mock readiness and scripted manual activation from
unavailable real voice conversation. `npm run health` runs the same command with npm's heading.

Stop each foreground service with Ctrl+C (or send SIGTERM to its PID). Services
close clients and remove their own sockets. Stop audio to see health degrade;
restart it to see a fresh health request recover. No work resumes automatically.
After SIGKILL or a crash, a stale socket can remain: confirm the corresponding
process is stopped, then remove only its stale socket, for example
`rm "$XDG_RUNTIME_DIR/jarvis/audio.sock"`, before restarting. An existing socket
is refused rather than replacing a possibly running service.

Normal desktop sessions provide `$XDG_RUNTIME_DIR` (usually `/run/user/<UID>`).
It must be an absolute path, owned by your user with permissions 0700. The services
create a 0700 `jarvis` subdirectory and 0600 sockets. Do not use shared `/tmp`
as the runtime root. For a headless development shell only:

```sh
export XDG_RUNTIME_DIR="$(mktemp -d /tmp/jarvis-XXXXXX)"
```

Use that same exported directory for both services and health. Very long paths
are rejected because Unix sockets have a platform path limit. The services
never create a public TCP listener.

Checks from the root:

```sh
npm run check
npm test
# While developing one seam:
npm run build
node --test dist/tests/config.test.js
node --test dist/tests/core.test.js
node --test dist/tests/transport.test.js
uv run --frozen python -m unittest discover -s tests -p config_test.py
```

`check` runs TypeScript types/Biome and Python mypy/Ruff; `test` builds and runs
Node unit/contract tests plus Python unit tests. Real contract tests launch both
processes in a disposable private runtime directory. They require Unix-socket
binding, but no hardware. CI runs the same locked installs, checks and tests.
The public `createCore(clock)` interface accepts scripted service events and
reports status and requested operations; its clock is controllable in tests.
Scripted manual turns request mock recognition, inference, synthesis and
playback operations. Further conversation actions belong to subsequent tickets.

Troubleshooting: `command not found` → install the named prerequisite and run
doctor; `missing_environment` → use the locked install commands above;
`invalid_config` → inspect the documented field/constraint; `unsafe_runtime_directory`
→ use your private user runtime directory; `socket_in_use_or_unavailable` → check
for an existing service or stale socket; health `unavailable` → start audio/core;
health `timeout` → inspect the content-free service diagnostic and restart the
stalled peer. Deliberate `config` output may show configured device/model names;
routine health/errors never include transcripts, prompts or raw input messages.

Hardware validation remains open: wake models/licensing, German STT/TTS,
headset/speaker behavior, spoken stop, desktop lock/mute, device recovery,
recognition allowance, latency, resource use and offline model-backed operation.
No performance or voice capability measurements are claimed by M0.

## Scripted manual turn (#02)

With both services running, activate once, then submit an utterance within the
configured listening limit (30 seconds by default):

```sh
node dist/apps/core/main.js activate
node dist/apps/core/main.js demo 'Wie geht es dir?'
```

`activate` reports `listening` after the mock acknowledgment completes; no key
needs to stay pressed. `demo` from idle also activates automatically, so this
single command runs the whole scripted turn:

```sh
node dist/apps/core/main.js demo
```

The core reports `acknowledging → listening → thinking → synthesizing → speaking
→ idle`. Core operation logs show intermediate statuses and IDs;
`playback_completed` includes completion, delivered UTF-16 character count and
exchange elapsed time. CLI output contains content-free final status JSON. The
fixed mock reply is “Dies ist eine simulierte Antwort von Jarvis.” Recognition
copies the explicit script, inference produces that fixture, and synthesis and
playback return simulated results from Python. No sound is audible and no
microphone or model is used. Health now reports `manual_activation:mock` when
ready; real `voice_conversation` remains `unavailable`.

Set `interaction.activation_sound:false` in the shared YAML to skip the
acknowledgment. `vad.max_utterance_seconds` bounds listening (30 s default);
`transport.timeout_ms` bounds each other operation (1000 ms default). A stalled
turn returns to idle without replay. Only one turn and one operation are active;
another activation during a turn returns `busy`. Each transcript/answer is
limited to the smaller of 4096 UTF-8 bytes and `llm.max_context_tokens` (8192 by
default), using bytes as a conservative mock context budget rather than a model
tokenizer. Transport frame and connection limits still apply. Content stays in
memory, with no prompt or transcript logs. Completed reply access at the public
core boundary expires after `transport.timeout_ms` (1000 ms default), and is
replaced on activation or cleared on service loss.
Follow-up conversations, cancellation/replacement and real audio are later tickets;
this slice closes to idle after delivery.
