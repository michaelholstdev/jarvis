# Jarvis — M0 mock foundation

A Node.js/TypeScript core and a separate Python audio service exchange validated
messages over private Unix sockets. No microphone, speaker, speech model,
Ollama, cloud fallback or external tool is needed. This milestone verifies the
runnable foundation. German voice conversation and manual activation are
**unavailable**; a successful health check means only the mock services are ready.

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
degraded/unavailable, an invalid configuration or a protocol failure. Output
distinguishes mock readiness from unavailable manual activation and voice
conversation. `npm run health` runs the same command with npm's heading.

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
M0 requests no audio or inference operations. Full conversation actions belong
to subsequent tickets.

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
