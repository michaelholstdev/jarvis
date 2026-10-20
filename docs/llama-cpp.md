# Local llama.cpp conversations (#27)

Jarvis can use an independently managed `llama-server` with an already installed
GGUF model. No model download, build, service start or backend fallback happens
inside Jarvis. [ADR-0002](adr/0002-selectable-local-inference.md) expands the
inference choice in ADR-0001; the conversation and audio boundaries are shared.

## Configuration

Use the same configuration file for both Jarvis services. Retain your existing
stable microphone/output IDs and absolute STT/TTS model paths:

```yaml
llm:
  mode: llama.cpp
  provider: llama.cpp
  base_url: http://127.0.0.1:18080
  model: jarvis-bonsai
  max_context_tokens: 8192
  num_predict: 512
  temperature: 0.3
  seed: 0
  timeout_ms: 120000
audio:
  mode: voice
```

| Mode | Provider | Behavior |
| --- | --- | --- |
| `mock` | `ollama` or `llama.cpp` | Scripted answers, no inference requests |
| `ollama` | `ollama` | Existing `/api/chat` and `/api/tags` adapter |
| `llama.cpp` | `llama.cpp` | `/v1/chat/completions`, `/health`, `/v1/models` |

Other mode/provider combinations fail validation in both services. Defaults stay
`mode: mock`, `provider: ollama`, port 11434, model `user-configured`, preserving
existing configurations. Explicitly set all four selection fields when switching;
changing only the URL or provider does not enable a different live protocol.

`model` must match an `id` from `/v1/models`, usually the server's `--alias`.
Jarvis sends `num_predict` as `max_tokens`, and sends `temperature` and `seed`
directly. The existing ranges/defaults apply: 1–2048 output tokens (512),
0–2 temperature (0.3), 0–2147483647 seed (0), total generation deadline
100–300000 ms (120000). A seed alone does not promise reproducibility across
server versions, GPU backends, templates or other server sampling defaults.

`max_context_tokens` retains Jarvis's conservative history byte budget; it is
not a tokenizer or a llama.cpp capacity control. Individual input/output remains
bounded by min(4096, configured budget) UTF-8 bytes; completed history evicts
oldest exchanges. No `num_ctx` is sent to llama.cpp. Set `--ctx-size` on the server
with room for system instruction, serialized history, current question and output;
parallel slots may divide available context. Inspect actual per-slot capacity
in the server startup output and `/props`. Server context overflow fails locally.

## Server startup and health

Inspect the installed version's help/API before launching. A command matching
the installed PrismML fork used during implementation is:

```sh
/home/michael/progz/llama-prism/build/bin/llama-server \
  --model /home/michael/models/Ternary-Bonsai-2-27B-PQ2_0.gguf \
  --alias jarvis-bonsai --host 127.0.0.1 --port 18080 \
  --ctx-size 8192 --parallel 1 --n-gpu-layers 99 \
  --reasoning-format deepseek --no-ui
```

This is an explicit operator action, not a Jarvis startup step. Do not launch a
second listener on an occupied port or change a separately managed service.
Model path, compatible quantization/backend build, GPU layers/device, context,
parallelism and chat template belong to server launch configuration. Use
`llama-server --version`, `--list-devices`, its startup output and process GPU
information to verify the actual placement. Requested GPU layers alone are not
proof that every layer ran on GPU.

Start the inference server first, then `jarvis-audio.service`, then
`jarvis-core.service`. Jarvis periodically retries bounded non-generating probes
if inference is initially unavailable. It never replays a question on recovery.
A failed question needs explicit `Noch einmal` or a new question.

```sh
curl --max-time 2 --silent http://127.0.0.1:18080/health
curl --max-time 2 --fail --silent http://127.0.0.1:18080/v1/models
curl --max-time 2 --fail --silent http://127.0.0.1:18080/props
node dist/apps/core/main.js health
```

The probe shares one `transport.timeout_ms` deadline across health/model requests,
caps each response at 1 MiB and never requests a completion or model load.
`/health` 200 with `status: ok` plus the exact configured model ID means ready.
The documented 503 loading payload means loading; a healthy server without the
selected ID means missing-model; other statuses, invalid responses and timeouts
mean unavailable. Content-free `inference_readiness` diagnostics distinguish
`ready`, `loading`, `missing-model`, `unavailable`; CLI inference capability is
ready/unavailable. No generated content or server error body enters diagnostics.

Requests use HTTP loopback only, pin localhost to IPv4 loopback, ignore proxies
and refuse redirects. SSE handles split UTF-8, CR/LF/CRLF, multiline data,
comments, usage chunks and `[DONE]`; a stop/length finish and nonempty answer
are required. A terminal event closes the connection without waiting for EOF.
Malformed/incomplete/error/tool responses fail without speaking partial content.
The full generation stream is capped at 1 MiB. Speech waits for completion.
The adapter requests `reasoning_format: deepseek` and collects only assistant
`delta.content`, ignoring separate reasoning fields. Inline think tags fail closed;
use a compatible server/template that separates reasoning. Tools are never sent
or executed. Manual replacement, stop, lock and mute cancel the HTTP request;
operation IDs reject stale results. Microphone/STT/TTS behavior is independent
of the provider.

## Switching back and headset trial

Set `mode: ollama`, `provider: ollama`, the original loopback endpoint and installed
Ollama model, then restart both Jarvis services. See [Ollama setup](ollama.md).
For mock demonstrations use `mode: mock`; neither inference backend is contacted.

After confirming the actual headset is connected and the user is ready, verify
unlocked/unmuted health, activate manually, ask a short German question, then ask
a contextual follow-up. Start another question and use `stop` or manual activation
during generation; canceled content must never play in the next turn. End the
conversation explicitly. Record device IDs, exact source/build, model checksum,
server/settings, content-free outcomes and human quality observations. This
focused trial does not pass #17's full quality/latency/model comparison matrix.

API references: [upstream server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
installed source `tools/server/README.md` and `server-common.cpp` at
`e3de715222b2667c54a267441159a5729f11155e` in the local PrismML checkout.
[Implementation evidence](../.scratch/jarvis-mvp/llama-cpp-acceptance-2026-10-20.md).
