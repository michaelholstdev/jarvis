# Local German output

Ticket 08 adds optional real output to the scripted core. Recognition and inference
remain scripted; wake detection and microphone capture remain unavailable. Default
`audio.mode: mock` still needs no models/audio session. Core health keeps `mode:
mock` to describe the scripted conversation; audio advertises `mode: piper` and
`tts: ready` when the real worker loaded. `voice_conversation` remains unavailable.

## Install and verify

Use Python 3.10–3.12 on Linux, Node 22+, uv and the existing project npm dependencies.
On CachyOS, install only missing `libpulse` (libpulse-simple and pactl) and use the
existing PipeWire + pipewire-pulse user session. No additional sound server,
capture stack, STT, CUDA, ROCm or Ollama installation is required by this ticket.

```sh
npm ci
npm run build
uv sync --frozen --extra output
.venv/bin/python -c 'from importlib.metadata import version; print(version("piper-tts"), version("onnxruntime"), version("soxr"))'
```

Piper **1.3.0** (GPL-3.0), soxr **1.0.0**, and transitive CPU ONNX/numpy artifacts
are pinned with package hashes in `uv.lock`. The worker rejects a different Piper
version and explicitly selects only `CPUExecutionProvider` with two inference
threads. The wheel includes espeak-ng data; no separate espeak executable is used.
The tested environment was Python 3.11 with ONNX Runtime 1.31.0.

Download the provisional Thorsten medium voice and config from the exact revision:

```sh
mkdir -p models
curl --fail --location https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx -o models/de_DE-thorsten-medium.onnx
curl --fail --location https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json -o models/de_DE-thorsten-medium.onnx.json
printf '%s\n' '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819  models/de_DE-thorsten-medium.onnx' '974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85  models/de_DE-thorsten-medium.onnx.json' | sha256sum --check
```

Startup independently verifies both checksums. No automatic download or network
inference occurs. `config/models.json` records revision, SHA-256, config SHA-256,
source and provenance. The [pinned model card](https://huggingface.co/rhasspy/piper-voices/blob/c10ece1aade47bb51c153c893d14e5bf8e5b7117/de/de_DE/thorsten/medium/MODEL_CARD)
declares the Thorsten dataset CC0 and notes fine-tuning from lessac medium; it does
not provide a separate comprehensive weights license. Preserve this provenance
when redistributing. Quality remains provisional; high is not bundled.

## Select output and replay

```sh
pactl --format=json list sinks
pactl list short sinks
```

Copy the stable sink **name**, such as
`alsa_output.usb-Logitech_Logitech_G430_Gaming_Headset-00.analog-stereo`.
Numeric indexes and `default` are deliberately not selected in real mode. Configure
an absolute model path and use the same configuration for both services:

```yaml
audio:
  mode: piper
  output_device: alsa_output.usb-Logitech_Logitech_G430_Gaming_Headset-00.analog-stereo
tts:
  voice: de_DE-thorsten-medium
  model_path: /absolute/path/to/jarvis/models/de_DE-thorsten-medium.onnx
```

```sh
export JARVIS_CONFIG=/absolute/path/to/config.yaml
.venv/bin/python apps/audio/main.py
# In another terminal with the same JARVIS_CONFIG:
node dist/apps/core/main.js start
# In a third terminal:
node dist/apps/core/main.js health
node dist/apps/core/main.js demo 'Synthetische Testfrage.'
node dist/apps/core/main.js stop
node dist/apps/core/main.js activate
node dist/apps/core/main.js demo 'Gespräch beenden'
```

`demo` exercises activation → scripted recognition/inference → real synthesis →
output. Stop can be issued from another terminal during playback. `activate`
replaces an unfinished turn. Existing `mute`/`lock` commands stop the worker and
clear pending audio; `unmute`/`unlock` never resume it. Interaction flags disable
activation/end tones independently. Enabled tones are distinct 120 ms tones.

Piper remains resident across normal turns. A single worker holds at most one
synthesized reply (2048 Unicode characters, 60 seconds at the voice rate). It
resamples 22050 Hz mono explicitly with libsoxr to the selected sink's reported
rate (8000–192000 Hz), then submits signed 16-bit little-endian mono. There is no
application audio queue or content on disk. A second audio request gets `busy`.
The control socket remains available for cancellation/privacy. Frame and connection
limits still apply. Synthesis and output operations use the configured playback
watchdog (default 120 seconds); short control exchanges retain transport deadlines.

`playback_started` means the first PCM write succeeded on an opened stream,
not a measured acoustic onset. `playback_completed` follows successful server
drain; synthesis completion never implies playback completion. Core follow-up
starts after that result. Cancel/privacy destroys the process and Pulse stream,
erases its PCM and model memory, and emits `interruption` with monotonic
milliseconds and the operation ID. Cancellation also records its target operation
ID; privacy barriers have no target. The next use reloads the model. The server/device may have a small already-submitted hardware tail.
Completed replies report their UTF-16 text length. Interrupted replies retain only fully drained sentence prefixes. The current
sentence is omitted even if partly audible; this voice has no validated word
alignment. Delivery diagnostics contain operation IDs and UTF-16 character counts,
never answer content. See [delivered context](delivered-context.md) for real
playback measurements, reproducible interruption/follow-up checks and limits.

## Checks and troubleshooting

Deterministic checks: `npm run check` and `npm test`. They do not require output
libraries or a voice. Separate opt-in real adapter + public core/socket check:

```sh
uv sync --frozen --extra output
npm run build
.venv/bin/python scripts/verify-output.py models/de_DE-thorsten-medium.onnx
```

This creates/removes an ephemeral 48 kHz silent PulseAudio null sink. It checks
resident synthesis, resampling, drain completion, manual stop, worker restart and
privacy through the core/socket path. It does not establish audible headset or
speaker quality, acoustic start timing, voice stop, hotplug, suspend recovery,
latency percentiles or VRAM measurements. Use the replay commands on the selected
headset/speaker and record those results separately. Never infer spoken-stop
support from the manual stop test.

- `missing_voice`: install both files at `tts.model_path` and its `.json` sibling.
- `unsupported_voice`: select the manifest's pinned Thorsten medium ID.
- `voice_checksum_mismatch`: run the checksum command, then redownload the pinned files.
- `output_runtime_unavailable`: verify the optional environment, `pactl info`,
  `pactl list short sinks`, and `ldconfig -p | rg libpulse-simple`; select a present
  stable sink name. Output startup deliberately fails without falling back to a
  different device. The child stderr is suppressed to prevent library diagnostics
  leaking input content.
- `unavailable` during output: inspect content-free service events and health,
  check the sink is still connected, then issue an explicit new activation/retry.
  Recovered services never replay the question automatically.

Models are not bundled or marked hardware-validated. Changing sink rates while a
worker is resident requires restarting audio so it rediscovers the current rate.
