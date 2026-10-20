# Health and local recovery

Build first with `npm run build`, then inspect the running core:

```sh
node dist/apps/core/main.js health
node dist/apps/core/main.js config
```

Health exit 0 means the audio handshake and any required recovery cleanup succeeded, including while muted; exit 1
means an unavailable peer, timeout or protocol/configuration failure. `audio`
and `audio_diagnostic` identify that connection. `capabilities` separates wake,
STT, TTS and inference. Missing wake permits `manual_activation:mock`; missing
STT/TTS means voice conversation is unavailable. Inference unavailable identifies
the model gateway separately. All supported speech/inference is **simulated**:
`voice_conversation:unavailable` is intentional even when all mock services work.
`last_failure` reports only a capability and fixed diagnostic code;
`retry_available` never exposes the retained question. Check `inhibitions` and
`privacy_pending` when manual activation is unavailable despite a healthy peer.

After a failed turn, recover the peer, then explicitly retry or ask a new question:

```sh
node dist/apps/core/main.js demo 'Noch einmal'
node dist/apps/core/main.js demo 'Meine neue Frage'
```

Only standalone retry requests use the unsuccessful question. The conversation
must still be open (normally 20 seconds after failure). Recovery, a health query,
or restarting audio never repeats a question. After expiry, activate and restate
it. Restarting core loses all conversation context. A connected but stalled peer
hits the exchange watchdog; a stalled playback hits its separate watchdog, then
requires confirmed cancellation before further work. Failed cancellation exposes
degraded health. No repeated idle sounds or automatic question retries occur.

For the current foreground mock setup, stop the affected service with Ctrl+C
(or SIGTERM to its known PID) and restart it from the repository root, in its
original terminal and with the same `XDG_RUNTIME_DIR` and `JARVIS_CONFIG`:

```sh
.venv/bin/python apps/audio/main.py
node dist/apps/core/main.js start
```

Audio is probed every two seconds by default, with at most one ordinary probe in
flight. A peer's process exit/disconnect is detected on the next request/probe;
reconnect restores readiness after any required cleanup is acknowledged. For SIGKILL/crashes, confirm the specific process
is stopped (`ps -ef`), then remove only its stale socket before restarting:

```sh
rm "$XDG_RUNTIME_DIR/jarvis/audio.sock"  # only after audio is confirmed stopped
# For a stopped core instead: rm "$XDG_RUNTIME_DIR/jarvis/core.sock"
```

A live socket is never replaced automatically. The core does not own or restart
Ollama. For installed KDE services, desktop hotplug/suspend handling and exact lifecycle
commands, use [the deployment guide](../systemd/README.md). Mock health cannot
validate hardware behavior. Do not enable root services or linger.

For bounded journal collection during foreground development, run the services
under separate identifiers instead of redirecting into growing files:

```sh
systemd-cat --identifier=jarvis-audio .venv/bin/python apps/audio/main.py
systemd-cat --identifier=jarvis-core node dist/apps/core/main.js start
journalctl --user -t jarvis-core -t jarvis-audio --since '10 minutes ago' -n 100 --no-pager
journalctl --disk-usage
```

The core emits at most 100 routine diagnostic lines per 30 seconds and drops
excess lines without retaining them. Startup has one additional readiness line.
Python emits only startup/fatal diagnostics. Logs contain operation names/IDs,
states, timings and fixed error codes, never utterances, prompts, answer text,
raw audio, or exception payloads. Use health for current status if logs were
suppressed. Journal storage is managed by the host; keep its existing finite
`SystemMaxUse`/`RuntimeMaxUse` policy or have the administrator set one before
long unattended runs. Jarvis creates no log files or transcript archives.

`recovery.probe_interval_ms` and `recovery.playback_timeout_ms` are the runtime
watchdog settings; see [configuration](configuration.md) for defaults/ranges.
Process restart is manual for foreground development. Installed user units use
`Restart=on-failure`, `RestartSec=15s`, `StartLimitIntervalSec=60s`,
`StartLimitBurst=5`, and host-managed finite journal retention.
After installing the user units, exact inspection/recovery is:

```sh
systemctl --user status jarvis-core.service jarvis-audio.service
journalctl --user -u jarvis-core.service -u jarvis-audio.service -n 100 --no-pager
systemctl --user restart jarvis-audio.service
# If a restart limit was hit, diagnose first, then:
systemctl --user reset-failed jarvis-audio.service
systemctl --user start jarvis-audio.service
```

These systemctl commands require [unit installation](../systemd/README.md).
Hardware, acoustic cue, real-model recovery, and actual restart timing require
[desktop acceptance](desktop-acceptance.md).

In real voice mode, audio-service/transport recovery restores readiness without
starting another microphone capture. Press the activation shortcut again before
speaking a retry or a new question. The existing follow-up deadline still bounds
retained retry/context; recovery and health probes do not renew it. Ordinary
successful replies still open their automatic follow-up window.
While recovered voice waits for activation, conversation-duration expiry does
not start an extension prompt. Deliberate activation can request that prompt;
the original follow-up deadline still closes retained context normally.


If `audio_cleanup_pending:true`, the peer may still have old work running.
Healthy hello responses do not release this gate. Jarvis requests a silent
stop-all barrier and waits for its acknowledgment before activation or follow-up
recognition. An unresponsive barrier exposes a timeout and remains gated across
reconnect and conversation expiry. Restart the stopped/stalled audio service as
above; the fresh peer must still acknowledge cleanup. This clears audio-side
work without replaying the retained question. Core context expires on its
original follow-up deadline even while cleanup is blocked.

## Inference failure diagnostics

Real inference emits one `inference_terminal` event per attempt through the
selected gateway, on success, failure or cancellation (subject to the routine
100-lines/30-seconds diagnostic bound). The turn driver also records
`operation_failed` with the fixed protocol `code` before dispatching a current
inference failure. Stale results cannot deliver answers or failure feedback.

Terminal fields are content-free:

| Field | Meaning |
| --- | --- |
| `turn_id`, `operation_id` | Recognition turn and inference operation correlation; `unknown` if invoked outside a recognized turn |
| `backend`, `model` | Configured provider and model alias (model bounded to 128 characters) |
| `elapsed_ms`, `monotonic_ms` | Attempt duration and local monotonic event timestamp |
| `outcome` | `success`, `failure`, or deliberate `cancelled` |
| `category` | `none`, `cancelled`, `empty_answer`, `timeout`, `connection_failure`, `http_failure`, `malformed_stream`, `incomplete_stream`, `unsupported_response`, or `output_size_limit` |
| `generation_limit` | Configured `num_predict`; this change does not raise it |
| `http_status` | Numeric HTTP rejection status when an HTTP request fails, otherwise `unknown`; response bodies are never logged |
| `finish_reason` | Allowlisted `stop`, `length`, `tool_calls`, `function_call`, `content_filter`, or `unknown` |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | Nonnegative safe integer usage reported by the server, otherwise `unknown`; Ollama has no reported total |
| `answer_chars`, `reasoning_chars` | Accumulated UTF-16 code units; reasoning count is `unknown` unless the server sends a separate reasoning string |
| `first_stream_ms`, `first_answer_ms` | Time from gateway entry to first stream activity and first answer content; `unknown` if absent |

Allowlisted finish reasons and reported usage are captured before unsupported
tool output is rejected; available answer/reasoning counts remain content-free.
No token counts are estimated from characters. A usable answer with finish
reason `length` succeeds. Empty or unusable responses and broken streams do not
by themselves mark inference unavailable. HTTP 4xx request rejections (such as
400 for context overflow or 422 for invalid parameters) also preserve readiness.
Other HTTP failures, connection failures and timeouts retain readiness probing
and explicit recovery. Failed output never enters
conversation history. Earlier delivered exchanges remain available while the
conversation stays open; “Noch einmal” or a new question is required.

Where audio works, `indicate-failure` speaks once: “Ich konnte keine Antwort
erzeugen. Sag ‘Noch einmal’, um es erneut zu versuchen.” This fixed feedback is
not a delivered answer. Manual stop/replacement and lock/mute can cancel it.
Synthesis failure falls back to one tone (`failure_indication_fallback`);
`failure_indication_spoken` identifies the speech path. If output is unavailable,
health and bounded operation diagnostics remain, with no recursive notification.

Inspect a short journal interval without changing services or generation settings:

```sh
journalctl --user -u jarvis-core.service --since '10 minutes ago' -n 100 --no-pager -o cat
journalctl --user -u jarvis-audio.service --since '10 minutes ago' -n 100 --no-pager -o cat
```

Find `inference_terminal`, then correlate `operation_id` and `turn_id` with
`operation_started`/`operation_failed`. Check `category`, finish reason, reported
usage, counts and timings before forming a hypothesis. Do not capture prompts,
transcripts, answer/reasoning strings, raw server errors or credentials. These
local fixture results reproduce empty and reasoning-only output, but do not
establish the cause of the 2026-10-20 incident. A later physical rerun must record
the candidate/model/configuration and measured results separately; none was
performed for this implementation.
