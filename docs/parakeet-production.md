# Production Parakeet CPU recognition (#20)

Parakeet TDT v3 INT8 is now selectable through the existing audio worker and
`StreamingRecognizer` boundary. It consumes a complete endpointed utterance and
returns one final transcript; it does not provide partial streaming. Conversation
control, standalone voice phrases, follow-up deadlines, bounded capture and stale
result rejection use the existing core/service path. Spoken stop remains opt-in
and acoustically unvalidated with either recognizer.

## Install and select

Use Python 3.11 on Linux x86-64 and the existing PipeWire/Piper installation.
No new runtime is needed: `uv sync --frozen --extra input --extra output` installs
sherpa-onnx/core **1.13.8** and soxr **1.0.0**, with wheel hashes in `uv.lock`.
Both sherpa versions are checked on load. CPU, two decoding threads and greedy
search are fixed; no speech GPU provider, cloud fallback or inference download.

Acquisition is explicit and online; loading and inference are offline. These are
#16's exact archive and runtime, with selected extracted-file hashes pinned in
[`config/models.json`](../config/models.json). Verify the archive before extraction:

```sh
mkdir -p models/parakeet
curl --fail --location https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 -o /tmp/jarvis-parakeet.tar.bz2
printf '%s\n' '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf  /tmp/jarvis-parakeet.tar.bz2' | sha256sum --check
tar -xjf /tmp/jarvis-parakeet.tar.bz2 -C models/parakeet --strip-components=1 sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/decoder.int8.onnx sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/joiner.int8.onnx sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt
curl --fail --location https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx -o models/parakeet/silero_vad.onnx
```

The archive is release asset **283097583**, updated **2025-08-16T09:29:29Z**.
Parakeet weights use **CC-BY-4.0** (NVIDIA); preserve attribution when distributing
this sherpa ONNX export. sherpa-onnx is Apache-2.0, Silero MIT; Piper and voice terms
remain in the [output guide](audio-output.md). See #16's
[provenance and primary sources](recognition-comparison.md#sources-and-compatibility).
The manifest's `validated: false` means acoustic acceptance remains open.

Merge into the same private `JARVIS_CONFIG` used by both services:

```yaml
stt:
  engine: sherpa-onnx
  model: parakeet-tdt-v3-int8
  device: cpu
  model_dir: /absolute/path/to/jarvis/models/parakeet
```

The directory must contain `encoder.int8.onnx`, `decoder.int8.onnx`,
`joiner.int8.onnx`, `tokens.txt`, and `silero_vad.onnx`. Verify after setting config:

```sh
.venv/bin/python -c 'from apps.audio.main import load_config; from apps.audio.input import verify_input; verify_input(load_config()); print("selected input checksums verified")'
```

Restart both services after changing configuration. Keep `audio.mode: mock` for
hardware-free operation; mock mode loads no recognizer. In `voice` mode missing or
corrupt selected artifacts fail with `missing_input_model` or
`input_checksum_mismatch` through content-free diagnostics and degraded health.
Unknown model IDs fail schema validation without echoing values. A runtime failure
never silently substitutes Whisper or downloads a model.

Whisper compatibility is preserved: the default remains `whisper-tiny-int8` with
`model_dir: models/input`. Its existing install commands still apply. To migrate,
change **both** model and directory; Whisper files are not required by Parakeet.
To return to Whisper, select its model and directory explicitly. Whisper failed
#16's synthetic quality screen; backward compatibility is not a quality endorsement.

## Reproduce the production checks

```sh
npm run build
# JARVIS_CONFIG must select Parakeet; the script supplies temporary silent devices.
.venv/bin/python scripts/verify-input.py models/de_DE-thorsten-medium.onnx models/parakeet --report /tmp/parakeet-production.json
npm run check
npm test
```

The synthetic check renders “Was ist die Hauptstadt von Deutschland?” using pinned
Thorsten, `noise_scale=0`, `noise_w_scale=0`, `length_scale=1`; soxr resamples to
48 kHz PCM16 with one second of silence at each end. It exercises actual capture,
16 kHz conversion, VAD, Parakeet, core/socket scripted reply and Piper/output drain.
A separate public `Output.run` check asserts the exact German recognition. Cancel
and privacy during real speech must destroy the worker/capture group, return no
transcript and reject previously admitted stale work; another activation reloads.
Missing and corrupt artifact checks start the actual worker and require rejection.
Only synthetic fixture identity and content-free timings/resources enter the report.
No physical microphone is opened and fixture audio/transcripts are not retained.

The report's CPU seconds cover the entire check, including model reloads, synthesis,
CLI polling and deliberate failed loads. Peak child RSS is the largest reaped
process high-water mark, **not** simultaneous service memory or idle RSS. This is
one synthetic integration observation, not acoustic latency, a percentile result,
concurrent Ollama acceptance or an independent speech GPU allocation measurement.

## Production observation — 2026-10-19

[Raw content-free report](../benchmarks/recognition/production-parakeet.json),
CachyOS Linux x86-64, Ryzen 5 **5600X**, Python 3.11.14; uncontrolled logged-in
desktop, scripted inference with no Ollama generation. This report identifies the
task-start parent; use the commit containing it to find the implementation.

| Observation | Result |
| --- | ---: |
| Scripted activation → reply completion (one turn, includes input fixture silence) | 6979 ms |
| Core-path capture/endpoint | 3556 ms |
| Core-path final recognition after endpoint | 232 ms |
| Public adapter exact German fixture | passed |
| Cancellation / privacy barriers during speech | 32 / 33 ms |
| Whole-check elapsed | 36.261 s |
| Harness / reaped children CPU time | 3.383 / 27.707 s |
| Harness / largest child peak RSS | 774.8 / 1158.2 MiB |

The committed report is authoritative for endpoint timing. These are single-run
integration observations; do not infer p50/p95 or physical speech-end-to-audible
latency. The largest child includes resident Piper + VAD + Parakeet. Model reloads
and deliberate errors contribute to whole-check CPU; it is not an idle CPU result.
CPU providers are fixed, but dedicated speech VRAM was not independently sampled.
The previous Whisper evidence remains unchanged.

## Handoff to #17

Use this production config for the short human headset trial, then settle the LLM
and speech choices before collecting quality/latency scenarios. Record candidate
commit, config, model hashes, devices and Ollama state. Check ordinary German,
technical terms, deterministic end/extension/retry phrases, cancellation and
follow-ups. File focused bug tickets for observed failures. Preserve #16's old
comparison and #17/#18 Whisper reports as historical evidence; do not relabel them
as Parakeet runs. Human German accuracy, physical latency, headset/speaker voice
stop and target desktop release acceptance remain **unvalidated**.
