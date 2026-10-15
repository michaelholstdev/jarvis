# Health and local recovery

Build first with `npm run build`, then inspect the running core:

```sh
node dist/apps/core/main.js health
node dist/apps/core/main.js config
```

Health exit 0 means the audio handshake works, including while muted; exit 1
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
reconnect restores readiness. For SIGKILL/crashes, confirm the specific process
is stopped (`ps -ef`), then remove only its stale socket before restarting:

```sh
rm "$XDG_RUNTIME_DIR/jarvis/audio.sock"  # only after audio is confirmed stopped
# For a stopped core instead: rm "$XDG_RUNTIME_DIR/jarvis/core.sock"
```

A live socket is never replaced automatically. The core does not own or restart
Ollama. The real Ollama adapter, device hotplug/suspend recovery, and installed
systemd user units remain later integration tickets; mock health cannot validate
those capabilities. Do not enable root services or linger for these mocks.

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
Process restart is deliberately manual in this foreground release. For the
future user units, use `Restart=on-failure`, `RestartSec=2s`,
`StartLimitIntervalSec=60s`, `StartLimitBurst=5`, and finite journal retention.
Once those units are installed by ticket #12, exact inspection/recovery is:

```sh
systemctl --user status jarvis-core.service jarvis-audio.service
journalctl --user -u jarvis-core.service -u jarvis-audio.service -n 100 --no-pager
systemctl --user restart jarvis-audio.service
# If a restart limit was hit, diagnose first, then:
systemctl --user reset-failed jarvis-audio.service
systemctl --user start jarvis-audio.service
```

These systemctl commands do not apply until the units exist. No hardware,
acoustic cue, real-model recovery, or restart timing is claimed as validated.
