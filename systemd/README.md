# Login startup on KDE Plasma / PipeWire

Jarvis runs as two **user** services, tied to `graphical-session.target`. No root
service, tray or application window is required. Ollama remains independently
managed. Do not enable linger: Jarvis is intended to run only during login.
`Type=exec` plus bounded `ExecStartPost` handshake checks expose service startup;
voice readiness is reported separately by the CLI. Both units restart on failure
at 15-second intervals, with a limit of five starts per 60 seconds. That spacing
also permits recovery when a headset or PipeWire is absent at login, without
exhausting the limit during an ordinary persistent device outage.

## System packages (administrator step, separate from user services)

On the target CachyOS/Arch installation, install the missing dependencies using
the distribution package manager: Node.js >=22 at `/usr/bin/node`, Python >=3.10,
uv, systemd, `glib2` (`gdbus`), `libpulse` (`pactl` and libpulse-simple),
`pipewire`, `pipewire-audio`, `pipewire-pulse`, and `wireplumber`. KDE Plasma must
provide the session screen locker. Follow the distribution's PipeWire migration
instructions if another audio server is installed; Jarvis does not replace it.
Install Ollama and its local model separately as described in
[the Ollama guide](../docs/ollama.md). These are system setup steps, not root
Jarvis services. Do not run npm, uv, or Jarvis as root.

## User installation

Run from the checkout root. Stop any foreground Jarvis processes first. The
stable installation link below must be absent; if it already exists, inspect it
and use that existing checkout rather than overwriting it.

```sh
npm ci
uv sync --frozen --extra input --extra output
npm run build
mkdir -p "$HOME/.local/share"
ln -s "$PWD" "$HOME/.local/share/jarvis"
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis"
install -d -m 700 "${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
# First installation only: do not overwrite an existing config.
(umask 077; test -e "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml" || cp config/defaults.json "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml")
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml"
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -m 600 systemd/jarvis-audio.service systemd/jarvis-core.service "$HOME/.config/systemd/user/"
```

JSON defaults are valid YAML. Edit the configuration before starting:

- Set `audio.mode: voice`, `llm.mode: ollama`, and the installed Ollama model.
- Set `audio.input_device` and `audio.output_device` to exact stable PulseAudio
  **names**, never numeric indexes or `default`. Discover them with
  `pactl --format=json list sources` and `pactl --format=json list sinks`.
- Install the manifest-pinned Piper, Whisper and Silero models using
  [input setup](../docs/audio-input.md) and [output setup](../docs/audio-output.md).
  Paths are relative to the stable checkout link; absolute paths also work.
- A physical mute must be exposed as the selected source's PulseAudio `mute`
  property. A switch that only cuts the electrical signal cannot be detected by
  this integration; validate your headset's switch using `pactl` before acceptance.

The schema validates configuration in both services. Config and state directories
must be owned by your user and private (0700); the config file should be 0600.
State is reserved under `$XDG_STATE_HOME/jarvis` (default `~/.local/state/jarvis`);
conversation content remains in memory and no transcript/state archive is written.
Sockets are 0600 under `$XDG_RUNTIME_DIR/jarvis` (0700). There is no public listener.
Standard KDE login supplies the user D-Bus and runtime directory. If using custom
XDG variables, import them into the user manager **before** starting the units:

```sh
systemctl --user import-environment XDG_CONFIG_HOME XDG_STATE_HOME
systemctl --user daemon-reload
systemctl --user enable jarvis-audio.service jarvis-core.service
systemctl --user start jarvis-audio.service jarvis-core.service
systemctl --user status jarvis-audio.service jarvis-core.service
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" health
loginctl show-user "$USER" -p Linger
```

`Linger=no` is expected. If you previously enabled linger for unrelated services,
review their needs before changing it; this installation never enables it. The
units stop with KDE's graphical session. Inspect the graphical target if they do
not start on login: `systemctl --user status graphical-session.target`.

Health exit 0 / `ready:true` means the service handshake and cleanup succeeded;
it does not imply an available microphone or model. Expect
`manual_activation:ready` and `voice_conversation:ready` for configured real voice
with available models and devices. Wake remains unavailable: **manual-only** is
the supported mode. `mock` indicates simulated configuration, not real voice.
`inhibitions.locked` also covers unknown desktop/device state and suspend;
`hardware_muted` combines explicit CLI hardware mute with source mute/unknown
source state. A CLI unlock/unmute cannot clear a desktop-owned inhibition.

## KDE global shortcut

Open **System Settings → Keyboard → Shortcuts**, add a command/application
shortcut, and set its command to the following, replacing `/home/YOU` with the
absolute home path (the shortcut editor does not expand shell variables):

```text
/usr/bin/node /home/YOU/.local/share/jarvis/dist/apps/core/main.js activate
```

Assign an unused chord such as Meta+J and apply. One press starts acknowledgment,
then microphone listening after the cue finishes; do not hold the key. The same
press replaces unfinished thinking/speech. No terminal/tray must be open. For
manual cancellation use the CLI `stop` command. See the acceptance checklist for
measuring shortcut-to-cue and cue-to-capture timing on your hardware.

## Inspection, recovery and shutdown

```sh
journalctl --user -u jarvis-core.service -u jarvis-audio.service -n 100 --no-pager
systemctl --user stop jarvis-core.service jarvis-audio.service
systemctl --user start jarvis-audio.service jarvis-core.service
systemctl --user restart jarvis-audio.service
systemctl --user reset-failed jarvis-audio.service jarvis-core.service
```

After `reset-failed`, explicitly start the services again. Diagnose the fixed
startup/config diagnostic first. Journald owns retention; inspect
`journalctl --disk-usage` and use the host's finite journal limits. Logs omit
transcripts, answer content, prompts and raw audio.

The desktop core (`start-desktop`) monitors KDE `ActiveChanged`/`AboutToLock`,
logind `PrepareForSleep`, and PulseAudio subscriptions. It reconciles snapshots
every two seconds with bounded 1.5-second command deadlines, one sample in flight,
and epoch checks against stale snapshots. Events during a sample request one
immediate replacement sample. A separate bounded source-mute query cancels work
without waiting for KDE/logind queries; volume and capture-state events alone do
not cancel healthy capture. Lock/suspend notifications inhibit
immediately on receipt; mute/device changes are reconciled from source/sink
snapshots. Signal loss or unreadable state inhibits capture; monitor restart is
bounded to the two-second tick. No physical stop-latency claim follows from these
software bounds. An entering-lock signal stays latched until unlock (or monitor
reconnect), so a pre-lock snapshot cannot reopen capture.

For reconnect/resume problems, inspect health, `pactl --format=json list sources`,
`pactl --format=json list sinks`, and
`systemctl --user status pipewire.service pipewire-pulse.service wireplumber.service`.
A selected device disappearing, changing index, or backend loss cancels and
clears the conversation. Reconnecting/unmuting restores readiness after the
privacy barrier; only a new press starts capture. A new device name requires a
config edit and restart of **both** units. No automatic fallback to another
microphone or replay of old work occurs. A stuck lock acquisition may require
unlocking or restarting core; unknown state always stays inhibited.

Startup preparation reclaims only an owned Unix socket that refuses connections;
it rejects live sockets, symlinks and regular files. This permits restart after
SIGKILL without deleting a running peer's socket. Never run foreground and
installed copies together. Use `start-desktop` for real desktop privacy; plain
`start` is the existing simulated/foreground control entrypoint and does not
subscribe to desktop state.

## Update and uninstall

Stop both units before updating dependencies, models, config or the checkout.

```sh
systemctl --user stop jarvis-core.service jarvis-audio.service
# Update this checkout using your normal Git workflow, then:
npm ci
uv sync --frozen --extra input --extra output
npm run build
npm run check
npm test
install -m 600 systemd/jarvis-audio.service systemd/jarvis-core.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user start jarvis-audio.service jarvis-core.service
```

For uninstall, remove the KDE shortcut, then:

```sh
systemctl --user disable --now jarvis-core.service jarvis-audio.service
rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/jarvis-core.service" "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/jarvis-audio.service"
systemctl --user daemon-reload
systemctl --user reset-failed
# Remove only the installation symlink, after checking its target:
readlink "$HOME/.local/share/jarvis"
unlink "$HOME/.local/share/jarvis"
```

Keep or deliberately delete your config, models and reserved state directory as
preferred. No conversation archive needs deletion. Other services, Ollama and
system packages are independently managed. See
[desktop acceptance](../docs/desktop-acceptance.md) for passed software checks
and the still-unvalidated target-desktop gate.
