# #27 llama.cpp integration evidence — 2026-10-20

Candidate: implementation based on `003847bea329d3f97420d7e93b66e57895db00bb`;
final delivery commit is the commit containing this record. Live checks used the
working-tree candidate during implementation; the temporary runtime loaded before
the bare-CR terminal fix committed in `f0186e1`. The installed server uses LF/CRLF,
which passed live. Final fixtures also validate bare CR; the later review change
only unifies Ollama HTTP transport. No final-build physical rerun is claimed. No model download,
installation or change to the independently managed Ollama service occurred.
User authorized a temporary llama.cpp process and isolated headset trial.

## Installed source, model and placement

- Local checkout: `/home/michael/progz/llama-prism`, PrismML fork,
  `e3de715222b2667c54a267441159a5729f11155e`.
- Binary: `build/bin/llama-server`, `0.2.0-dev`, build 10777,
  commit `e3de71522`, GNU 16.2.1, Linux x86_64.
- Model: `/home/michael/models/Ternary-Bonsai-2-27B-PQ2_0.gguf`,
  SHA-256 `3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1`.
  `/v1/models`: 26,895,998,464 parameters, size 7,195,047,936 bytes,
  `PQ2_0 - 2.13 bpw (group 128)`, trained context 262144.
- Temporary launch: installed binary with `--model` above, `--alias jarvis-bonsai`,
  `--host 127.0.0.1 --port 18080 --ctx-size 8192 --parallel 1 --n-gpu-layers 99
  --reasoning-format deepseek --no-webui`. Startup confirms one slot, 8192 context;
  model endpoint confirms `n_ctx: 8192`.
- `--list-devices`: ROCm0 AMD Radeon RX 9070 XT, 16304 MiB total.
  Process opened `/dev/kfd` and `/dev/dri/renderD128`, mapped `libggml-hip.so.0.21.0`;
  DRM fdinfo reports PCI `0000:2d:00.0`, VRAM 7,738,052 KiB after generation.
  This verifies ROCm/GPU use; individual layer placement was not logged at the
  installed default verbosity.
- No preexisting llama.cpp process or user unit was found. Ollama was running.
  This temporary launch is not a persistent service installation.

## Actual server API check

Used Jarvis's adapter directly, not a compatibility SDK. Health and exact model
probe passed. German question completed, answer contained expected capital;
contextual follow-up completed and contained expected country. No prompt/reply
content was added to routine logs or this record. First request completion took
1600 ms (API only, not headset or first audible latency). Settings: max_tokens
128, temperature 0.3, seed 0, reasoning extraction `deepseek`; remaining sampling
and template settings are server defaults. Explicit cancellation after 100 ms
rejected with content-free `unavailable`, no answer returned, subsequent health
probe ready. Successful API integration is not a quality/model-selection pass.

## Physical headset trial

User confirmed readiness and authorized pausing/restoring installed Jarvis units.
An isolated runtime/config uses the existing Jieli USB microphone,
`alsa_input.usb-Jieli_Technology_USB_Composite_Device_4150345930323108-00.pro-input-0`,
and output `alsa_output.pci-0000_2f_00.4.analog-stereo`. CPU Parakeet TDT v3 INT8
from `models/parakeet`; CPU Thorsten medium from
`models/benchmark/de_DE-thorsten-medium.onnx`. Original settings retained except
llama.cpp selection and manual-only activation for this focused trial. Generation:
512 output tokens, temperature 0.3, seed 0, history budget 8192, timeout 120000 ms.
PipeWire/Pulse desktop endpoints are explicitly preserved while Jarvis sockets
use an isolated runtime. Desktop privacy guard is enabled.

Initial missing USB microphone correctly inhibited capture. After user reconnect,
first setup attempt failed before recognition because the isolated process lacked
the desktop PipeWire runtime path. Corrected the temporary environment with
`PIPEWIRE_RUNTIME_DIR`; no production config/code workaround was needed.

Observed physical outcomes: six generated replies completed synthesis/playback;
the first two requested German/contextual turns completed without inference or
playback errors. The cancellation question reached inference operation 39;
manual CLI stop approximately 626 ms later canceled it, no synthesis/playback
for that question followed, and healthy follow-up resumed. A subsequent question
completed playback, demonstrating recovery without stale output. Spoken ending
was recognized and close-conversation playback completed, returning idle.
Routine records contain operation IDs, timing, character counts and state only.
Human audibility/context/quality feedback is pending; runtime completion alone
is not a human quality pass or physical audible-latency measurement.

Both installed Jarvis units were restored to active using their original config
and installed code; the isolated processes and temporary inference process were
stopped. No persistent backend switch or installation update is implied.

## Review and repository validation

Code-review compared the implementation against starting commit
`003847bea329d3f97420d7e93b66e57895db00bb` on independent Standards/Spec axes.
Standards: no documented breaches; one duplication smell resolved by moving
Ollama NDJSON framing onto the same bounded HTTP transport; reviewer verified
resolution. Spec: no implementation findings. Hardware evidence was finalized
after review. No #17 full quality/model/latency gate is closed.

`npm run check` passed: TypeScript, Biome, Ruff and both mypy scopes.
Targeted adapter/runtime regression run passed 44 tests after transport review.
Full suite passed: `npm test`, 253 Node tests and 66 Python tests.
