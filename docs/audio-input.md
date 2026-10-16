# Manual German microphone turns

Ticket 09 adds opt-in `audio.mode: voice`: manual activation → completed activation
sound → selected microphone → resident CPU Silero VAD → endpointed CPU sherpa-onnx
Whisper tiny INT8 (multilingual, `language=de`, `task=transcribe`) → existing scripted
answer → resident CPU Piper → selected output. Inference is scripted unless [Ollama mode](ollama.md) is enabled.
`mock` remains the default; `piper` retains scripted recognition.

This mode implements manual microphone turns. In mock inference mode, reactivate for each further question;
wake detection, spoken stop, barge-in and calibrated
German accuracy are **unvalidated**. Health reports STT/TTS ready, inference mock and
voice_conversation unavailable in mock inference mode, so this ticket does not imply MVP release readiness.

## Installation and model verification

Use the [Piper installation/voice guide](audio-output.md) first. Install PipeWire's
`pw-record`/`pw-play` clients and `pactl`/libpulse in the existing user session.
The input capture path uses native PipeWire; output retains PulseAudio compatibility.
Linux x86-64 Python 3.11 is the verified environment; other wheel/platform combinations
remain unvalidated. No GPU inference, cloud service or automatic model download.

```sh
uv sync --frozen --extra input --extra output
npm run build
mkdir -p models/input
curl --fail --location https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2 -o /tmp/jarvis-whisper-tiny.tar.bz2
printf '%s\n' 'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1  /tmp/jarvis-whisper-tiny.tar.bz2' | sha256sum --check
tar -xjf /tmp/jarvis-whisper-tiny.tar.bz2 -C models/input --strip-components=1 sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx sherpa-onnx-whisper-tiny/tiny-tokens.txt
curl --fail --location https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx -o models/input/silero_vad.onnx
.venv/bin/python -c 'from apps.audio.main import load_config; from apps.audio.input import verify_input; verify_input(load_config()); print("input checksums verified")'
```

Both runtime versions (sherpa-onnx **1.13.8** and sherpa-onnx-core **1.13.8**) are
required and checked at load; the latter supplies the native ONNX CPU libraries.
Runtime wheels and their SHA256 hashes are in `uv.lock`; soxr is **1.0.0**. Models
are checked independently on worker load before microphone access. `config/models.json`
records each selected file's SHA256, source, release-asset ID/update revision and
licensing/provenance. Release URLs can be replaced upstream; checksums are authoritative.
Archive asset **179373699**, updated **2024-07-13**; VAD asset **271935959**, updated
**2025-07-11**. The archive's unused FP32 models and example recordings are not required.

[Whisper](https://github.com/openai/whisper/blob/main/LICENSE),
[Silero](https://github.com/snakers4/silero-vad/blob/master/LICENSE) and
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE) use MIT,
MIT and Apache-2.0 respectively. Preserve those notices when distributing artifacts;
Piper/voice licensing remains as described in the output guide. This small endpointed
backend is a provisional CPU alternative; the architecture's Parakeet comparison is
still open. `StreamingRecognizer` is a replaceable boundary; its current implementation
returns one final transcript, **not true partial streaming**.

## Device selection and operation

```sh
pactl --format=json list sources
pactl --format=json list sinks
pw-dump
```

Choose stable `name` values, not numeric indexes or `default`. For a normal microphone,
use its `alsa_input...` name. A `.monitor` source deliberately captures a sink only
when explicitly selected (used by the synthetic check). Capture resolves its matching
PipeWire `node.name`. Missing/muted devices fail without selecting another microphone.
PipeWire stream properties `node.dont-fallback`, `node.dont-reconnect` and
`node.dont-move` prevent fallback and retargeting; see
[PipeWire properties](https://docs.pipewire.org/page_man_pipewire-props_7.html).

```yaml
audio:
  mode: voice
  input_device: alsa_input.YOUR_STABLE_MICROPHONE_NAME
  output_device: alsa_output.YOUR_STABLE_HEADSET_NAME
  sample_rate_hz: 16000
  pre_roll_ms: 750
stt:
  model: whisper-tiny-int8
  model_dir: /absolute/path/to/models/input
tts:
  model_path: /absolute/path/to/de_DE-thorsten-medium.onnx
vad:
  end_silence_ms: 350
  max_utterance_seconds: 30
```

Set the same `JARVIS_CONFIG` for both services, start audio then core, and activate:

```sh
.venv/bin/python apps/audio/main.py
node dist/apps/core/main.js start
node dist/apps/core/main.js health
node dist/apps/core/main.js activate
# Speak after the activation sound. Silence finishes the question.
node dist/apps/core/main.js mute
node dist/apps/core/main.js unmute
```

`activate` returns while the turn runs so lock/mute/replacement commands remain
available from another terminal. Lock/mute closes the conversation and kills the
worker **and its capture process group** before the privacy acknowledgment. Clearing
inhibition never resumes a prior question. Models reload on the next activation.
The device's own mute/missing status is checked before capture and every 250 ms
while capturing; explicit Jarvis lock/mute controls interrupt immediately. Backend
checks may take up to their two-second watchdog; submitted hardware output can have
a small already-buffered tail. Do not infer desktop lock integration from CLI tests.

Manual-only idle opens no microphone and invokes no recognizer. After acknowledgment,
a temporary 750 ms ring preserves audio preceding VAD onset; it is bounded/overwritten
and cleared on closure. There is no pre-activation idle capture. Native-rate signed
16-bit multichannel PCM is explicitly averaged to mono, then libsoxr resamples
continuously to 16 kHz float32. VAD consumes 512-sample windows, threshold **0.5**,
minimum speech **128 ms**, illustrative end silence **350 ms**. The total listen cap
is **30 seconds**, including initial silence; the core, socket and worker permit the
configured recognition completion allowance (default **5 seconds**) afterward.
The worker uses one fixed listen-plus-recognition deadline, independent of the
playback watchdog; speech/endpoint events cannot renew it. A timeout closes
the request and destroys the worker, never delivering an obsolete transcript.
All thresholds remain provisional pending real headset/speaker tests. Speech shorter
than the minimum can be ignored; Whisper tiny can hallucinate or misrecognize German,
noise and technical terms. Two short synthetic questions failed exact matching in
initial exploration; one longer fixed question passed. This is not FR-04's ≥30-utterance
accuracy benchmark or evidence of calibrated accuracy.

## Checks and diagnostics

```sh
npm run check
npm test
.venv/bin/python scripts/verify-input.py /absolute/path/to/voice.onnx /absolute/path/to/models/input
```

The opt-in command creates/removes **two silent temporary sinks**, synthesizes a fixed
German question in memory, feeds its selected monitor, and exercises actual capture,
resampling, VAD, final STT, the public core/socket scripted reply, Piper and selected
output drain. It also asserts the fixed question's final recognition at the public
audio run seam. It never opens a physical microphone or saves fixture audio/transcripts.
It reports content-free listen/STT and total timings; those include queue/capture
setup and are not acoustic latency percentiles. No raw audio/transcript/prompt appears
in routine logs; current conversation content remains transient in core memory.

`audio_diagnostic` supplies safe fixed codes while the socket returns `unavailable`:

- `missing_input_model` / `input_checksum_mismatch`: verify all four pinned files in
  `stt.model_dir`; verify archive hash before extracting, then rerun verification.
- `unsupported_input_model`: select `stt.model: whisper-tiny-int8`; other backends
  require a replacement adapter and their own manifest/verification.
- `unsupported_input_runtime`: sync both pinned input runtime packages.
- `input_device_missing` / `input_device_muted`: select the present stable source,
  inspect `pactl get-source-mute NAME`; never silently switch microphones.
- `input_disconnected`: inspect PipeWire/WirePlumber and the selected device, then
  explicitly reactivate. No automatic replay after recovery.
- `output_device_missing` / `output_device_muted`: inspect the selected sink and
  its mute state. Output is checked before operations.
- `audio_runtime_failed` / `output_runtime_unavailable`: check `pw-record --help`,
  `pactl info`, model hashes and runtime installation. When running Jarvis under a
  temporary runtime directory, preserve `PIPEWIRE_RUNTIME_DIR` and `PULSE_SERVER`
  pointing at the real user audio session, as the synthetic command does.

Hardware mute/lock behavior, lost-device/suspend recovery, acoustic clipping,
headset/speaker intelligibility, GPU allocation measurements, latency distributions
and German corpus accuracy remain unvalidated. No model is marked validated in the
manifest. Manual cancellation does not establish spoken-stop support.

Final synthetic sample on the development machine: activation-to-reply-completion
6851 ms; capture/endpoint 3854 ms; final STT after endpoint 196 ms. These single
samples establish the integration path only. They do not establish p50/p95,
physical microphone quality, or the end-of-speech-to-audible-answer target.
