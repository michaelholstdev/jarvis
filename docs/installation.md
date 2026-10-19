# Manual-only CachyOS installation

This is the installation runbook for ticket #19. The supported implementation
path is manual activation, endpointed Whisper tiny INT8 + Silero on CPU, Piper
Thorsten medium on CPU, and independently managed local Ollama. It is an
**experimental setup, not a validated hardware release**. Read the
[release checklist](release-checklist.md) before accepting it. Production Whisper
failed the synthetic quality screen; Parakeet is benchmark-only. No conversational
LLM has yet passed human quality acceptance.

Run commands from the checkout root unless stated otherwise. This guide describes
a first installation; stop existing Jarvis processes before reusing a checkout.
Never run npm, uv, model acquisition or either Jarvis service as root.

## 1. System prerequisites (administrator)

Target: CachyOS x86-64, KDE Plasma with screen locker, systemd user session,
PipeWire + pipewire-pulse + WirePlumber, stable microphone/headset names.
Architecture target: Ryzen 5 5600, 32 GB RAM, RX 9070 XT 16 GB. Existing measurements
used a **5600X**, approximately 32 GB and AMD Navi 48; they are not interchangeable
hardware acceptance. Other distributions/architectures are unvalidated.

Install missing system prerequisites through CachyOS's package manager. On an
already configured KDE/PipeWire machine:

```sh
sudo pacman -S --needed git curl tar bzip2 coreutils iproute2 nodejs npm python uv glib2 libpulse pipewire pipewire-audio pipewire-pulse wireplumber
```

Follow distribution migration instructions if replacing another sound server.
Do not replace a working audio session merely to follow this guide. Jarvis needs
`/usr/bin/node` >=22, `gdbus`, `pactl`, libpulse-simple, `pw-record`, `pw-play`,
`pw-dump` and a working user D-Bus. System Python >=3.10 satisfies the base project;
the real speech environment was verified with **Python 3.11 on Linux x86-64**.
Use 3.11 for reproducing speech results; other wheel combinations are unvalidated.

Ollama installation is independent: follow the
[Ollama setup guide](ollama.md#install-and-run-ollama-independently), including
backend/AMD-driver compatibility. No CUDA/ROCm package is required by CPU speech.
Registry/package/model downloads require networking during installation. Running
with previously installed models must work offline.

## 2. Checkout and locked user dependencies

Obtain the repository URL and exact commit from the release provider. No public
repository URL or binary distribution is assumed. Substitute both placeholders:

```sh
git clone REPOSITORY_URL jarvis
cd jarvis
git checkout --detach EXACT_COMMIT
node --version
npm --version
uv --version
uv python find 3.11
npm ci
uv sync --frozen --python 3.11 --extra input --extra output
npm run build
npm run doctor
```

If 3.11 is absent, explicitly acquire it with `uv python install 3.11`, then repeat
sync. Do not use an unpinned `pip install` as a substitute. `package-lock.json`
and `uv.lock` pin dependencies; keep `packages/` and `config/` with the compiled
`dist/`. The tested versions include Node 24.11.1, Python 3.11.14, uv 0.9.21,
sherpa-onnx/core 1.13.8, Piper 1.3.0 and soxr 1.0.0. Exact wheel hashes are in
`uv.lock`. This ticket does not claim to have downloaded these into a fresh account.
Doctor may fail if the shell has no private `$XDG_RUNTIME_DIR`; use a real KDE
login for desktop deployment, not a shared temporary runtime directory.

## 3. Acquire and verify speech models

Run the exact pinned download/checksum blocks in
[output installation](audio-output.md#install-and-verify) and then
[input installation](audio-input.md#installation-and-model-verification).
They install these files under the checkout (not bundled with source):

| Artifact | Local path | Identity / terms |
| --- | --- | --- |
| Thorsten medium voice + config | `models/de_DE-thorsten-medium.onnx` and `.onnx.json` | Revision `c10ece1aade47bb51c153c893d14e5bf8e5b7117`; SHA-256 for both in `config/models.json`; CC0 dataset, lessac fine-tuning ancestry; weights terms need review before redistribution |
| Whisper tiny INT8 encoder/decoder/tokens | `models/input/tiny-encoder.int8.onnx`, `tiny-decoder.int8.onnx`, `tiny-tokens.txt` | Release asset 179373699 (2024-07-13); archive SHA-256 `c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1`; MIT |
| Silero VAD | `models/input/silero_vad.onnx` | Release asset 271935959 (2025-07-11); file SHA-256 in `config/models.json`; MIT |

The linked blocks specify artifact URLs and independently expected hashes.
Upstream release assets can change: a mismatch is a failure, not permission to
replace the expected digest. Startup independently verifies installed files before
microphone access. All manifest `validated` fields remain false. Piper runtime is
GPL-3.0, sherpa-onnx Apache-2.0; preserve relevant notices and review the
[pinned voice provenance](audio-output.md#install-and-verify) before distribution.
Benchmark-only Parakeet (CC-BY-4.0) and Vosk small German (Apache-2.0) have separate
[artifact records](../benchmarks/recognition/artifacts.json); neither is installable
as a production STT configuration. Wake has no approved artifact/runtime pin.

## 4. Local Ollama and model inventory

Use one independently managed Ollama listener. For foreground operation, after
stopping any competing listener:

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
```

Keep that terminal running. For the system-service alternative, use the exact
local-only override in [the Ollama guide](ollama.md). Verify cloud-disabled startup
and loopback binding (`ss -ltnp`); setting Jarvis's URL alone does not disable cloud
features in the separate server. Jarvis accepts only HTTP loopback endpoints,
rejects redirects and never pulls models or falls back to cloud inference.

In a second terminal, online acquisition is deliberate. `qwen3:4b` below is an
example candidate, **not a tested model selection**:

```sh
ollama pull qwen3:4b
ollama --version
ollama list
curl --fail --silent http://127.0.0.1:11434/api/tags
ollama show qwen3:4b --license
ollama show qwen3:4b --modelfile
```

Record full digest, tag, quantization, size, license/source, acquisition date,
Ollama version/backend and generation settings in the installation record. Keep
verified local blobs; a mutable tag cannot reproduce an old run. The measured
Gemma 3 270M Q8_0 and Llama 3 8B Q4_0 inventories, full digests and settings are in
[latency evidence](latency-benchmarks.md#published-baseline--2026-10-17).
Their weak quality scores do not select either for deployment. Review the license
of the model actually installed; no blanket model redistribution permission is
claimed. Missing artifacts must fail locally when networking is disconnected.

## 5. Private XDG configuration

The units use a stable checkout link at `~/.local/share/jarvis`, even with custom
XDG data settings. Inspect an existing link before reusing it. First installation:

```sh
mkdir -p "$HOME/.local/share"
ln -s "$PWD" "$HOME/.local/share/jarvis"
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis"
install -d -m 700 "${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
(umask 077; test -e "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml" || cp config/defaults.json "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml")
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/jarvis/config.yaml"
pactl --format=json list sources
pactl --format=json list sinks
```

Edit the copied JSON (valid YAML), or convert it to YAML; merge these values into
its existing groups. Replace devices with the exact stable `name` values and set
model paths to your absolute checkout paths. Numeric IDs and `default` are rejected
by real mode. An explicit `.monitor` source is for synthetic tests, not a microphone.

```yaml
audio:
  mode: voice
  input_device: alsa_input.YOUR_MICROPHONE_NAME
  output_device: alsa_output.YOUR_HEADSET_NAME
stt:
  model: whisper-tiny-int8
  model_dir: /absolute/path/to/jarvis/models/input
tts:
  model_path: /absolute/path/to/jarvis/models/de_DE-thorsten-medium.onnx
llm:
  mode: ollama
  base_url: http://127.0.0.1:11434
  model: qwen3:4b
wake_word:
  model_path: null
  threshold: null
features:
  voice_stop: false
```

Keep other defaults from [configuration](configuration.md): CPU speech, 750 ms
bounded pre-roll after manual activation, 350 ms VAD silence, 30 s utterance cap,
20 s follow-up, 5 s recognition allowance, 300 s conversation/extension,
20 s extension response, 120 s playback/generation watchdogs. Activation and end
sounds default on. Wake, barge-in, external tools, tray, persistence and content
logging remain disabled. `echo_cancellation` does not establish acoustic support.
Non-null wake model/threshold values fail configuration; there is no enable switch.

```sh
unset JARVIS_CONFIG
node dist/apps/core/main.js config
.venv/bin/python -c 'from apps.audio.main import load_config; from apps.audio.input import verify_input; verify_input(load_config()); print("input checksums verified")'
```

Both services must read the same config. This runbook uses the XDG default;
`JARVIS_CONFIG` overrides need the same value in both unit environments and CLI.
Do not leave a shell-only override while expecting installed units to use it.
Directories must belong to the user (0700), config should be 0600; unit preparation
rejects unsafe directories. KDE supplies `$XDG_RUNTIME_DIR` (usually `/run/user/UID`),
owned by the user, 0700. Sockets are 0600 under its 0700 `jarvis/` directory.
State is reserved at `$XDG_STATE_HOME/jarvis`; no conversation archive is written.

## 6. User services, KDE shortcut and operation

Install and start the units without sudo:

```sh
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
install -m 600 systemd/jarvis-audio.service systemd/jarvis-core.service "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/"
# Only if custom XDG variables are set, import their actual values first:
systemctl --user import-environment XDG_CONFIG_HOME XDG_STATE_HOME
systemctl --user daemon-reload
systemctl --user enable jarvis-audio.service jarvis-core.service
systemctl --user start jarvis-audio.service jarvis-core.service
systemctl --user status jarvis-audio.service jarvis-core.service
loginctl show-user "$USER" -p Linger
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" health
```

Expected `Linger=no`. Do not enable linger; if it was enabled for another purpose,
resolve that separately before acceptance. Units are bound to
`graphical-session.target`, restart on failure every 15 s and use the desktop core
(`start-desktop`). Plain foreground `start` does not monitor real desktop privacy.
Unknown lock/mute/device state inhibits capture. Health exit 0 is a handshake,
not acoustic acceptance: also inspect `manual_activation`, `voice_conversation`,
`inference` and inhibitions. `mock` is not real readiness; wake is `unavailable`.

In KDE System Settings → Keyboard → Shortcuts add a command, assign an unused
chord (e.g. Meta+J), and replace `/home/YOU` with the literal absolute home path:

```text
/usr/bin/node /home/YOU/.local/share/jarvis/dist/apps/core/main.js activate
```

One press starts the cue, then bounded microphone capture. Speak after the cue;
no key hold. After playback, ask a follow-up within 20 s. Standalone
`Gespräch beenden` closes, `Weiter` explicitly extends at expiry, and
`Noch einmal` explicitly retries a failed question while context remains open.
From another terminal:

```sh
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" stop
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" activate
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" mute
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" unmute
node "$HOME/.local/share/jarvis/dist/apps/core/main.js" text
journalctl --user -u jarvis-core.service -u jarvis-audio.service -n 100 --no-pager
systemctl --user stop jarvis-core.service jarvis-audio.service
systemctl --user start jarvis-audio.service jarvis-core.service
```

`stop` silences playback; `activate` replaces thinking/speech. Physical spoken
stop is unvalidated and off by default. `text` deliberately exposes the latest
answer during its conversation; terminal scrollback/redirection can retain it.
Lock/mute/closure clears service access, not copies you made. Device recovery
never resumes a question automatically. Diagnose with [recovery](recovery.md) and
[systemd/device recovery](../systemd/README.md#inspection-recovery-and-shutdown).
Do not run foreground and installed copies together or delete a live socket.

## 7. Check, update, rollback and uninstall

```sh
npm run check
npm test
# Focused checks after build:
node --test dist/tests/config.test.js dist/tests/desktop-runtime.test.js
.venv/bin/python -m unittest tests.config_test
# Optional real path with private silent sinks, not acoustic acceptance:
.venv/bin/python scripts/verify-input.py models/de_DE-thorsten-medium.onnx models/input qwen3:4b
```

Run [desktop acceptance](desktop-acceptance.md),
[recognition](recognition-comparison.md), [latency](latency-benchmarks.md) and
[stability/offline](stability-acceptance.md) procedures for release evidence.
Do not infer physical support from a silent sink or unit test.

Before updating, record `git rev-parse HEAD`, model digests, config and lockfile
hashes; keep a private backup of the old config and verified model inventory.
Stop both units, select the reviewed new commit using your Git workflow, then:

```sh
npm ci
uv sync --frozen --python 3.11 --extra input --extra output
npm run build
npm run check
npm test
install -m 600 systemd/jarvis-audio.service systemd/jarvis-core.service "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/"
systemctl --user daemon-reload
systemctl --user start jarvis-audio.service jarvis-core.service
node dist/apps/core/main.js health
```

Recheck models, config compatibility and desktop privacy before use. Do not
silently repull mutable model tags. Rollback: stop units, restore the recorded
commit/config/models, repeat the locked install/build/unit-copy/check/start steps.
Updating documentation does not validate a new model, device or driver combination.

For uninstall, remove the KDE shortcut, then:

```sh
systemctl --user disable --now jarvis-core.service jarvis-audio.service
rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/jarvis-core.service" "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/jarvis-audio.service"
systemctl --user daemon-reload
systemctl --user reset-failed jarvis-core.service jarvis-audio.service
readlink "$HOME/.local/share/jarvis"
# Only after confirming this is the installation symlink:
unlink "$HOME/.local/share/jarvis"
```

Keep or deliberately remove checkout, config, models and reserved state. Ollama,
its model store, system packages and journal retention are separately managed;
Jarvis uninstall does not delete them. No conversation archive needs deletion.

## Fresh-account acceptance record

**2026-10-19: unvalidated.** Commands were checked against repository entrypoints,
units, schemas and model manifests on the existing development checkout. No fresh
CachyOS account was provisioned, no KDE shortcut/login was exercised and no
physical headset/speaker run was performed for #19. Unit tests and existing
synthetic evidence cannot close this gap.

To reproduce the remaining check, an administrator supplies a fresh ordinary
account on the target machine; log into KDE as that user with default XDG paths,
no inherited Jarvis config, venv, units or model cache, and disabled linger. Run
steps 1–7, recording each command's exit status and any deviation. Record checkout
SHA, OS/kernel, CPU/RAM/GPU, KDE/PipeWire/Ollama versions/backend, model hashes,
source/sink names, config and permissions. Re-login and confirm service startup
without a terminal. Follow desktop acceptance during capture, generation and
playback; test offline after all downloads, update/rollback, then uninstall and
re-login to confirm no Jarvis service/shortcut remains. Repeat acoustic results
separately for headset and speakers. Failed commands are failed for that setup;
unattempted steps remain unvalidated. Attach the content-free record to #19 and
update the release matrix only from those observations.
