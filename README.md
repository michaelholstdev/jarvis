# Jarvis — local German voice conversations

A Node.js/TypeScript core and a separate Python audio service exchange validated
messages over private Unix sockets. No microphone, speaker, speech model,
Ollama, cloud fallback or external tool is needed. This milestone verifies the
runnable foundation in default mock mode. Optional [CPU Piper output](docs/audio-output.md) speaks scripted answers through PipeWire. Opt-in [local Ollama conversations](docs/ollama.md) combine real German recognition, local generation, Piper output and automatic contextual follow-ups. Default mock mode remains hardware-free; real hardware quality remains unvalidated.

Layout: `apps/core` (CLI and orchestration), `apps/audio` (Python mock/optional Piper output),
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

Exit code 0 means both mock services completed the handshake and any required recovery cleanup; exit code 1 means
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
playback operations. Follow-up timing and ending are implemented at this same public boundary.

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
→ follow-up`. Core operation logs show intermediate statuses and IDs;
`playback_completed` includes completion, delivered UTF-16 character count and
exchange elapsed time. CLI output contains content-free final status JSON. The
fixed mock reply is “Dies ist eine simulierte Antwort von Jarvis.” Recognition
copies the explicit script, inference produces that fixture, and synthesis and
playback return simulated results from Python. No sound is audible and no
microphone or model is used. Health now reports `manual_activation:mock` when
ready; real `voice_conversation` remains `unavailable`.

Set `interaction.activation_sound:false` in the shared YAML to skip the
acknowledgment. `vad.max_utterance_seconds` bounds initial listening (30 s default);
`transport.timeout_ms` bounds acknowledgment, inference, and synthesis (1000 ms
default). Playback has a separate 120-second watchdog, so long answers do not
consume the follow-up window. A stalled inference/synthesis/playback requests cancellation and one failure cue where possible; failed cancellation degrades health without replay. Only one turn and one operation are active; manual activation during thinking,
synthesis or speaking cancels that operation for a replacement question (see #04 below).

## Contextual follow-ups and ending (#03)

Submit another scripted question while status is `follow-up`; no activation is
needed. The mock inference request receives completed question/reply exchanges,
and its deterministic follow-up answer refers to the previous exchange:

```sh
node dist/apps/core/main.js demo 'Was ist TypeScript?'
node dist/apps/core/main.js demo 'Und JavaScript?'
node dist/apps/core/main.js demo "Danke Jarvis, das war's"
```

Standalone `Gespräch beenden` and `Gute Nacht Jarvis` also end the conversation
before inference. Matching ignores case, surrounding whitespace, ordinary
commas and trailing sentence punctuation; curly apostrophes are accepted in
`das war’s`. Quoted phrases and phrases embedded in questions remain content.

The follow-up window starts at **playback completion**, defaults to 20 seconds,
and is configurable with `session.follow_up_seconds` (integer 5–60). Silence
closes it. Speech onset must arrive strictly before the original deadline.
Recognition may complete until the earlier of the onset plus
`vad.max_utterance_seconds`, or the original deadline plus
`session.recognition_completion_seconds` (default 5 seconds, integer 1–30).
Results at that bound are too late. Repeated onset events cannot extend it.
Empty/whitespace/oversized results return to the **original** follow-up deadline;
if that deadline passed, they close immediately. A valid question gets its next
window only after its reply finishes. The scripted CLI supplies a simulated
onset; these rules do not establish acoustic recognition performance.

Closure clears in-memory question, answer, delivered reply and history, and
requests audio cleanup with a distinct `close-conversation` operation. Its
`sound` flag uses `interaction.conversation_end_sound` (enabled by default),
separate from the activation acknowledgment. Python simulates cleanup and
sound completion; mocks hold no audio buffers and produce no audible sound.
Real capture, cleanup and sound assets remain later adapter work.

Each transcript/answer is limited to the smaller of 4096 UTF-8 bytes and
`llm.max_context_tokens`. Completed history evicts oldest exchanges until its
combined question/reply bytes fit that budget. This is a conservative mock
byte budget, not a model tokenizer. Transport frame/connection bounds still
apply. Replies stay available at the public core boundary during the session
and clear on closure, activation from idle; service loss retains context only within the open conversation. Conversation content
is kept only in memory, with no transcript, prompt or answer logs.

## Manual replacement and stop playback (#04)

`activate` during thinking, synthesis or speaking cancels the current operation,
waits for audio cancellation to report final delivery, then acknowledges and
listens for a replacement question. Earlier exchanges remain in context.
Activation from follow-up also keeps context; activation from idle starts fresh.
Activation during acknowledgment, listening or cancellation returns `busy`.

```sh
node dist/apps/core/main.js activate  # replace an unfinished turn
node dist/apps/core/main.js demo 'Meine Ersatzfrage'
node dist/apps/core/main.js stop      # silence playback, keep the conversation
node dist/apps/core/main.js demo 'Gespräch beenden'  # close and clear context
```

`stop` cancels speaking only; otherwise it does nothing. It opens the normal
follow-up window when cancellation confirms playback has stopped, without an
activation acknowledgment. Replacement instead waits for acknowledgment before
listening. End phrases clear the conversation. The core also accepts a scripted
`control-recognized` event with the current playback operation ID and standalone
`Stopp`; quoted/embedded words do not stop playback. This is a deterministic
control boundary, not acoustic recognition during playback (ticket #14).

Only the delivered prefix reported by playback/cancellation enters future
inference context. Zero delivery excludes the unanswered question entirely.
Generation and synthesis alone never count as delivery. Reports count UTF-16
code units and must stop at a Unicode character boundary. Canceled operation
results cannot deliver speech, change context, or advance the replacement turn.
Cancellation has the transport watchdog; a missing final report degrades audio and preserves context only within the bounded open conversation.

The Python mock completes playback immediately and retains its latest delivery
count for a matching cancellation. Delayed/partial/no-delivery scenarios are
scripted in public-boundary tests, including a delayed socket audio peer. No
sound or acoustic delivery is measured; real delivery tracking is ticket #15.


## Conversation expiry and extension (#05)

A conversation has a five-minute allowance from activation, separate from the
20-second inactivity follow-up window. Normal questions and manual replacement
do not restart this allowance. On expiry, a healthy listening/thinking/synthesis/
playback turn finishes. Jarvis then asks whether to continue, rather than opening
normal follow-up. Expiry between turns triggers the prompt immediately.

After the prompt finishes, the extension response window lasts 20 seconds.
Only standalone **Weiter** renews the allowance for five more minutes with
existing delivered context. The existing end phrases close immediately; silence
closes and clears context and temporary reply access. Questions, quoted commands,
noise and repeated speech onset cannot renew the window or invoke inference.
Manual activation cannot bypass the extension requirement. Renewal opens the
normal follow-up window, so ask the next question before that inactivity deadline.

In the mock mode, submit these commands after health reports `awaiting-extension`:

```sh
node dist/apps/core/main.js demo 'Weiter'
node dist/apps/core/main.js demo 'Und danach?'
node dist/apps/core/main.js demo 'Gespräch beenden'
```

Configure `session.max_duration_seconds` (default 300, range 30–3600),
`session.extension_duration_seconds` (300, 30–3600), and
`session.extension_response_seconds` (20, 5–60) independently of
`session.follow_up_seconds`. Extension recognition has a strict response deadline;
no extra recognition-completion allowance is added. Separate watchdogs can still
interrupt stalled work: maximum utterance for listening, 120 seconds for playback,
and the transport deadline for acknowledgment, inference, synthesis and cancellation.
These watchdogs do not turn normal expiry into playback cancellation.

Prompt synthesis, playback and recognition remain simulated. Fake-clock tests
verify lifecycle behavior; the socket integration verifies the daemon's own
expiry prompt and explicit scripted renewal through Python. Audible speech and
acoustic command recognition remain later hardware milestones.


## Lock and mute privacy controls (#06)

Use these commands with the mock services running:

```sh
node dist/apps/core/main.js mute
node dist/apps/core/main.js unmute
node dist/apps/core/main.js lock
node dist/apps/core/main.js unlock
node dist/apps/core/main.js hardware-mute
node dist/apps/core/main.js hardware-unmute
```

Software mute, desktop lock, and hardware mute are independent inhibitions.
Any one blocks activation and all capture (including wake processing/pre-roll),
recognition, generation, synthesis and playback. Applying an inhibition closes
the conversation immediately, invalidates in-flight operations, and clears
question, answer, delivered reply, history and timers. Audio receives a silent
privacy operation that cancels all work and clears temporary audio/pre-roll;
no end sound plays while inhibited. Late replies and playback reports cannot
restore content, even after unlocking/unmuting or starting a fresh conversation.

Health retains the conversation `state:idle` and reports separate `inhibitions`
(`locked`, `muted`, `hardware_muted`) plus `privacy_pending`. Inhibited idle
has `manual_activation:unavailable`; ordinary idle permits activation and, with
a future validated wake adapter, bounded wake processing/pre-roll. `ready`
continues to describe service availability, so a healthy muted service can
return exit code 0. Check `manual_activation` to determine activation readiness.

Clearing a flag leaves the other flags in effect. Only after **all** are clear
and audio confirms the latest privacy operation does manual readiness return.
Jarvis awaits a new activation; it never resumes the old conversation. Failed
or timed-out cleanup keeps activation blocked, including across audio loss and
reconnection. Privacy flags live in the current daemon; real startup/restart
integration must read current desktop/device state before enabling capture.

These commands and socket events **simulate** desktop and device signals.
The Python service holds no microphone, pre-roll or synthesis buffers and makes
no audible output. Tests verify cancellation and cleanup requests, independent
precedence, audio gating and stale-result rejection. Real KDE lock notifications,
PipeWire/device hardware-mute monitoring, physical buffer erasure and stop latency
remain unvalidated and belong to desktop/audio integration (ticket #12).


## Failure, retry and capability recovery (#07)

Health now reports separate mock/unavailable capabilities, the last content-free
failure and whether an unsuccessful question is available. Standalone
`demo 'Noch einmal'` retries it while the conversation remains open. A new
question replaces it; recovery alone never replays it. Audio reconnect is probed
automatically with bounded requests; uncertain old work requires acknowledged
silent cleanup before readiness returns, and stalled work requires cancellation
before one simulated failure cue. Idle failures stay silent.

See [health, troubleshooting, restart and log commands](docs/recovery.md),
[watchdog settings](docs/configuration.md) and the [socket contract](docs/protocol.md).
Speech, inference and cues remain mocked; real model/device recovery needs
separate adapter and hardware validation.

## Real German output (ticket 08)

Optional CPU Piper synthesis and PipeWire-compatible output are available for
scripted answers. Follow [installation, device selection, replay and validation](docs/audio-output.md).
The default remains hardware-free mock mode; microphone, STT and inference are still scripted.

Manual microphone turns: see [German capture and recognition setup](docs/audio-input.md).

## Local Ollama voice conversations (ticket 10)

See [Ollama installation, model provenance, configuration, health, voice operation and optional synthetic smoke check](docs/ollama.md). Set `audio.mode: voice` and `llm.mode: ollama` to enable the complete path; `llm.mode: mock` preserves the earlier scripted demonstrations.

Concise German speech and deliberate temporary CLI text access: [text answers](docs/text-answers.md).
