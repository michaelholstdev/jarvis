# Local Ollama conversations (ticket 10)

Enable `llm.mode: ollama` to replace scripted inference. `audio.mode: voice`
adds real microphone input and Piper output; default `mock` needs no hardware
or Ollama. See [input installation](audio-input.md) and [output installation](audio-output.md)
for the pinned CPU speech models, runtimes and stable device selection.

## Install and run Ollama independently

Use the official [Linux installation instructions](https://docs.ollama.com/linux).
Download and inspect the installer before running it; Jarvis never installs,
starts, stops, pulls models for, or changes the Ollama service. For CachyOS,
choose a supported Ollama build/backend for the installed AMD drivers; GPU
compatibility and performance on this machine remain unvalidated.

For a foreground user process (stop any existing Ollama listener first):

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
```

Stop it with Ctrl+C. If using the independently installed system service instead,
set these in `sudo systemctl edit ollama.service`:

```ini
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NO_CLOUD=1"
```

Then `sudo systemctl daemon-reload` and `sudo systemctl restart ollama`;
inspect with `systemctl status ollama` and `journalctl -u ollama -n 50`;
stop with `sudo systemctl stop ollama`. Run the two Jarvis services as your own
user. Ollama's [FAQ](https://docs.ollama.com/faq) documents local-only mode and
server environment settings. Verify its startup log says cloud is disabled.
A loopback endpoint by itself does not disable Ollama cloud models.

While online, deliberately acquire a **local** model, for example the provisional
`qwen3:4b` candidate (not an accuracy, latency, licensing or hardware endorsement):

```sh
ollama pull qwen3:4b
ollama --version
ollama list
curl --fail --silent http://127.0.0.1:11434/api/tags
ollama show qwen3:4b --license
ollama show qwen3:4b --modelfile
```

Record the acquisition date, exact model name/tag, **full digest** from `/api/tags`,
parameter size, quantization, source and license, Ollama version, GPU/backend and
Jarvis generation settings in your local installation/benchmark record. Tags can
move: retain the verified local blobs and compare the digest before reproducing a
run; do not silently pull updates. No model is bundled or marked validated.
Download dependencies and all speech/model artifacts first, then disconnect
external networking and repeat the smoke check. A missing model fails locally;
Jarvis makes no download, tool or cloud-fallback request.

## Configuration

Use the same configuration for both Jarvis processes:

```yaml
audio:
  mode: voice
  input_device: alsa_input.YOUR_STABLE_MICROPHONE_NAME
  output_device: alsa_output.YOUR_STABLE_HEADSET_NAME
llm:
  mode: ollama
  provider: ollama
  base_url: http://127.0.0.1:11434
  model: qwen3:4b
  max_context_tokens: 8192
  timeout_ms: 120000
  num_predict: 512
  temperature: 0.3
  seed: 0
# Also set absolute stt.model_dir and tts.model_path as in the speech guides.
```

`mode` is `mock` or `ollama` for this provider (also see [llama.cpp](llama-cpp.md)); endpoint validation accepts HTTP loopback only
(`127.0.0.1`, `localhost`, `[::1]`, explicit port). Requests use direct HTTP,
resolve localhost to IPv4 loopback, reject redirects and ignore proxy settings.
`timeout_ms` is a total generation deadline (100–300000 ms), including model
loading and stream stalls. `num_predict` is 1–2048, temperature 0–2, seed an
integer 0–2147483647. `max_context_tokens` is 512–32768 and is sent as Ollama's
`num_ctx`; 8192 is illustrative, with no quality/latency guarantee. Requests use
[streamed `/api/chat`](https://docs.ollama.com/api/chat), role-tagged allowed
history and a German system instruction. No tools are supplied or executed.

The existing core additionally limits individual questions/replies to the smaller
of 4096 UTF-8 bytes and the configured context limit, and evicts oldest exchanges
to fit that conservative history byte budget. This is **not token counting**;
Ollama's `num_ctx` controls the actual model window including prompt/output.
The HTTP stream is capped at 1 MiB including metadata. Oversized, malformed,
empty or incomplete replies fail as a whole; no partial answer is spoken.
Speech starts only after successful completed generation. Model thinking content
is ignored; long reasoning may still consume the stream/deadline budget.

For concise speech, detail requests and deliberate temporary CLI text access,
see [text answers](text-answers.md).

## Start, health and conversations

```sh
npm run build
.venv/bin/python apps/audio/main.py    # terminal 1
node dist/apps/core/main.js start     # terminal 2
node dist/apps/core/main.js health    # terminal 3
node dist/apps/core/main.js activate
```

Speak after the activation cue. After the answer finishes, the microphone opens
for the bounded follow-up window automatically, without reactivation. Standalone
`Gespräch beenden` closes it; silence also closes it. Empty/noise transcripts do
not renew the original deadline. Speech-onset progress permits the existing
bounded recognition completion allowance. Conversation expiry, `Weiter`, manual
replacement, stop playback, lock/mute and explicit `Noch einmal` retry keep the
same deterministic core rules. `stop` silences playback; acoustic spoken stop,
wake detection and general barge-in remain separate, unvalidated features.

Health `capabilities.inference` is `ready` when the configured model appears in
the bounded, non-generating [`/api/tags` probe](https://docs.ollama.com/api/tags).
This verifies installation/reachability, not a successful GPU generation.
`manual_activation: ready` means real STT capture is available;
`voice_conversation: ready` requires available real STT, TTS and inference and no
privacy/cleanup inhibition. These are operational health states, not benchmark
or acoustic quality claims. `ready`/CLI exit status still describes audio/control
service availability; inspect individual capabilities too. Unavailable inference
does not disable the manual control path. Probes coalesce and never replay work.
Manual stop and activation do not wait for inference health probes; a stalled
Ollama capability check cannot delay cancellation of the current turn.

A failed active question requests cancellation and one short failure cue. Recover
the service/model, then say `Noch einmal` or ask a new question while the session
is open. Idle failure stays silent. Replacement, lock/mute, expiry and shutdown
invalidate in-flight results; obsolete HTTP/audio requests close within the
20 ms operation check (subject to event-loop scheduling). Late chunks cannot
advance another turn or reach synthesis. No transcripts/prompts/replies enter
routine logs or persistent conversation storage.

## Checks and troubleshooting

Hardware-free: `npm run check` and `npm test` include a loopback fake server for
streaming, errors, timeouts, abort, context, explicit retry and daemon follow-ups.
Optional real-service **synthetic** voice exchange, using two temporary silent
PipeWire sinks and the real CPU speech models and local Ollama:

```sh
.venv/bin/python scripts/verify-input.py /absolute/path/to/voice.onnx /absolute/path/to/models/input qwen3:4b
```

It passes only after final recognition, real Ollama generation, Piper synthesis
and drained playback, then mutes capture and cleans up its processes/sinks.
It retains no fixture audio or conversation content. A silent sink proves the
integration path, not physical microphone/headset quality. This optional check
has not been run for ticket 10 in this environment because the speech artifacts
are absent. A separate real loopback adapter smoke check passed with the already
installed `gemma3:270m`, `num_predict: 64`, context 8192, temperature 0.3, seed 0;
it returned a completed 43-byte answer without logging its content. Model digest:
`e7d36fb2c3b3293cfe56d55889867a064b3a2b22e98335f2e6e8a387e081d6be`.
This tiny model is an integration fixture, not a model-quality selection. Real headset/speaker acceptance, offline hardware
operation, delivered-speech precision, GPU usage and latency remain unvalidated.

- Inference unavailable: inspect `/api/tags`, exact configured model name, port,
  independent service logs and model digest. No automatic model acquisition.
- `timeout`: increase the bounded generation deadline for cold model load or
  shorten context/output; inspect `ollama ps` for CPU/GPU placement. A recovered
  service requires explicit retry, never a replay.
- `invalid_message`/`frame_too_large`: check model output and reduce `num_predict`;
  partial, tool-only and empty replies cannot be spoken.
- STT/TTS unavailable: follow speech-guide model checksum/device diagnostics.
- Stop Jarvis with Ctrl+C in each terminal; stop Ollama separately as above.
