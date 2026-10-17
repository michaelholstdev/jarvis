# Voice latency and speech resources

Ticket #17 measures the deployed voice path, rather than adding isolated model
compute times. Run from the repository root in the logged-in PipeWire session.
The benchmark creates two private null sinks, captures only their monitors, and
starts isolated core/audio services with a private runtime directory. It does not
open the physical microphone or change the default input/output devices. All
questions are the original synthetic cases in `benchmarks/latency/cases.json`.
Generated audio, recognition, prompts and answers stay in memory. Published
reports contain case IDs, timing, screening booleans and configuration metadata.

## Prerequisites and commands

Use Node >=22 and Linux/Python 3.11 with the existing user PipeWire/Pulse services,
`pactl`, `parec`, `pw-play`, `pw-record` and libpulse. Follow the pinned model
[setup and verification](audio-input.md#installation-and-model-verification) for
Whisper tiny INT8 and Silero; follow the [Piper guide](audio-output.md) for Thorsten
medium. The [recognition corpus setup](recognition-comparison.md#reproduce) also
provides the pinned Thorsten and Whisper files. Copy its three Whisper files to
`models/input/` and acquire Silero using the input guide if reusing that directory.
Both speech manifests are checked before audio opens; dependencies are pinned in
`uv.lock`. The tested production recognizer remains Whisper, despite #16's
recommendation for a future Parakeet adapter.

```sh
uv sync --frozen --extra input --extra output --extra benchmark
npm ci
npm run build
curl --fail --silent http://127.0.0.1:11434/api/tags
curl --fail --silent http://127.0.0.1:11434/api/ps
.venv/bin/python -m benchmarks.latency.run --model gemma3:270m \
  --voice models/benchmark/de_DE-thorsten-medium.onnx --input-dir models/input \
  --samples 30 --context 2048 --num-predict 64 --output /tmp/gemma3-270m.json
.venv/bin/python -m benchmarks.latency.run --model llama3:latest \
  --voice models/benchmark/de_DE-thorsten-medium.onnx --input-dir models/input \
  --samples 30 --context 2048 --num-predict 64 --output /tmp/llama3-8b.json
.venv/bin/python -m benchmarks.latency.concurrent \
  --voice models/benchmark/de_DE-thorsten-medium.onnx --input-dir models/input \
  --output /tmp/concurrent.json
```

The harness never pulls models, changes Ollama settings, or unloads other models.
Use only independently installed local models; see [Ollama setup](ollama.md).
Compare each full `/api/tags` digest with the committed report before reproducing;
tags can move. Retain the same local blobs. A missing model fails before capture.
Run configurations sequentially, with other benchmark/test workloads stopped.
Record any other desktop activity. `--samples 1` is a smoke check, never sufficient
for a target verdict. Reports record runtime versions, exact speech revisions and
hashes, quantization, generation/context settings, voice, devices, system load,
governors, total GPU counters, Ollama version and loaded-model/VRAM inventories.
The source revision is the task-start parent when measured before committing;
use the commit containing the harness and report to reproduce that measurement.

## Measurement boundaries and interpretation

Every core diagnostic includes Linux monotonic milliseconds; audio worker events
use the same host clock. `operation_started` maps each operation ID to its
recognition operation's `turn_id`. Audio events carry their operation ID. The
markers include VAD `endpoint`, `recognition_final`, first nonempty LLM content
(`llm_first_token`, excluding thinking), first Piper chunk (`tts_first_audio`),
first Pulse write (`playback_started`), per-sentence drain (`playback_completed`),
and `interruption` with its cancellation target. Read the first start and final
drain for the reply, excluding activation and failure sounds. The core also emits
its receipt of completed playback. An endpoint is after VAD silence, **not** the
end of the user's waveform; a successful Pulse write is **not** proof of audibility.
Wake is unavailable in the current manual-only implementation (#13); no wake
sample is fabricated. Cancellation records when worker cleanup finishes, not
when a human first decided to interrupt. Privacy barriers have no target operation.
Diagnostics remain content-free and the existing core rate limit remains active;
a saturated collector can lose events and such a trace cannot prove coverage.

The independent input monitor's last PCM block above magnitude 32 gives speech
signal end; the output monitor's first such block gives reply signal start. Blocks
are 10 ms at 48 kHz; timestamps are monitor-read arrival times. This includes VAD
silence, STT, socket scheduling, complete LLM generation, complete TTS synthesis,
and output queueing to observed signal. Thorsten's pinned defaults are noise scale 0.667, noise width 0.8 and length
scale 1; output normalization and volume use Piper 1.3.0 defaults. No ONNX random
seed is set for synthesis, so generated PCM is not promised bit-identical between
runs. Fixture generation uses Piper's CPU loader; deployed TTS uses two intra-op
and one inter-op thread with the CPU memory arena disabled.
Piper is currently fully synthesized before
playback: first token and first chunk alone do not determine answer latency.
Monitor buffering, scheduling and thresholding add uncertainty beyond the 10 ms
block size. Quiet speech tails below the threshold are excluded. These are
**silent-sink signal proxies**, never physical acoustic/audibility measurements.
`audible_target` consequently stays `unvalidated` even when the proxy passes.

One separately reported initial query precedes measured warm trials. It may include
Ollama model loading, but OS caches and already loaded models are uncontrolled;
call it the *initial trial*, not a proven cold start. The five short cases repeat
six times for 30 attempts. These are 30 queries, not 30 distinct questions or
speakers. Natural follow-ups keep resident speech models and delivered history;
the production byte-bounded context eviction still applies. The benchmark sets a
one-hour allowance and 60-second follow-up window to avoid expiration/reloading
between samples, and records those settings. Inference uses no tools, temperature
0, seed 42, context 2048 and at most 64 generated tokens. Truncation may harm quality.

Latency uses nearest-rank percentiles on completed, nonnegative finite signal
pairs. All attempts and errors remain in the denominator. A proxy target verdict
requires at least 30 successful measurements and no missing attempts. The initial
p50 ≤1500 ms and p95 ≤3000 ms targets are unchanged. Misses are `failed`; insufficient
measurements are `unvalidated`. No percentile from successful subsets establishes
a passing run with failures. Raw content-free timings permit independent reanalysis. New runs checkpoint an
incomplete, explicitly unvalidated report after each trial and replace it with
the full report only after completion; interrupted runs are not passing baselines.

The usefulness screen checks case-specific required concepts in the temporary
text answer; only the boolean is retained. It is a deliberately narrow deterministic
screen, **not** a human rating of German fluency, factual completeness or contextual
conversation. Failure can originate in recognition, generation, truncation, or
screen vocabulary. Success does not prove good German. Human evaluation below
remains required before selecting a production conversational model.

## Resource attribution

The real-path harness samples only the audio service process tree (resident worker
and capture descendants) every approximately 100 ms. It records cumulative CPU
seconds, aggregate RSS, and per-process DRM fdinfo VRAM, and reports CPU relative
to one logical core (100% = one core). RSS includes shared mappings in each process;
it is not proportional/private RAM. The three-second idle interval is resident
manual-only idle before activation, not a long idle soak. Active includes listening,
STT, TTS, playback, waits and follow-up. Cumulative CPU resets after worker teardown
are excluded; a run with restarts may undercount CPU. Peaks between samples can be
missed. File-descriptor races/permission failures yield unknown VRAM rather than
invented zero. No open DRM descriptor in the inspected CPU-only speech tree is
reported as zero direct dedicated speech VRAM for that sample.

Resource sampling and diagnostic collection stop and are awaited **before** mute
or service teardown. Reports summarize frozen sample sets; the resident idle
interval cannot acquire cleanup samples. A diagnostic reader, signal monitor or
sampler that fails or stops prematurely aborts publication of a completed report
with a content-free error. Any prior checkpoint remains explicitly incomplete and
unvalidated; it cannot serve as a passing regression baseline.

The separate concurrency command loads CPU recognition and synthesis into two
resident processes and runs both for ten seconds after a three-second idle
interval. It samples its own process tree including both workers; the coordinator's
small overhead is included. The STT worker generates its fixed fixture before
idle measurement and releases the fixture voice; retained allocator pages from
that setup may remain in RSS. Both active inference engines use two CPU threads. This is a stress workload, separate from the deployed
half-duplex worker's serial scheduling. Ollama and the compositor are excluded
from both speech resource budgets; their GPU allocations must not be subtracted
from total GPU usage to infer speech VRAM. Ollama `/api/ps` and total GPU counters
are separate environment observations. Unknown measurements remain unvalidated;
a known nonzero dedicated speech allocation fails the zero-VRAM target.

## Remaining scenario protocol

Publish one independent report per scenario/configuration; never pool them into
the warm quiet short-query distribution. Keep model digests, voice, generation
settings, questions and sample counts fixed, and document any deliberate change.

| Scenario | Procedure and acceptance evidence |
| --- | --- |
| Warm / cold | Warm with one query, verify matching `/api/ps` digest. For cold, independently unload only the selected model when safe, record `/api/ps`, service startup and model-load state; repeat in fresh runs. Do not label file-cache warmth as controlled cold. |
| Short / long | Use the fixed short cases; separately use a versioned synthetic long-question corpus and long-context exchanges. Record context size and evictions. |
| Quiet / noisy / whisper | Use consented live trials or a versioned synthetic mix; record noise signal, level/SNR, microphone gain and distance. Measure the actual speech-end boundary independently. Synthetic mixes do not validate real whisper or room acoustics. |
| Headset / speaker | Select stable device names, record gain/mute/sample rate, room and distance. Independently record loopback/measurement microphone arrival with consent and report acoustic uncertainty; do not reuse a silent-sink proxy as physical evidence. |
| Ollama loaded / unloaded | Record `/api/ps` before/after and the requested digest, GPU backend and other loaded models. A model installed in `/api/tags` need not be loaded. Keep independent application ownership; no automatic unloading. |
| CPU/GPU load | Repeat under a documented reproducible workload, recording governors, affinity, load, GPU total allocation and Ollama allocation separately. |
| German usefulness | Human rates the five cases plus contextual follow-ups for German fluency, correctness, concise speech and relevance on a fixed 0–2 rubric; aggregate scores and case IDs without answers. Record evaluator and sample count. No human rating has been inferred from keyword screening. |
| Wake / interruption | Wake gate stays open under #13. Measure manual/voice stop separately, tracing cancellation and independent signal cessation; use #14's acoustic protocol. |

These procedures are available for reproduction; unperformed scenarios stay
unvalidated and do not become passing evidence because the harness exists.

## Regression baseline

The committed per-model JSON reports are the baseline; compare a new run with the
matching model/configuration, rather than comparing two different LLMs as a
regression. Device names of private synthetic sinks are normalized for comparison;
other settings, scenario, runtime versions and model digest must match. Inspect
hardware/load/model inventories manually before attributing a change to code.

```sh
.venv/bin/python -m benchmarks.latency.report \
  benchmarks/latency/gemma3-270m.json /tmp/gemma3-270m.json
```

Exit 0 means both percentiles are within **20%** of the same-configuration baseline;
exit 1 means a regression or insufficient samples, exit 2 means invalid/incomparable
reports. This provisional regression tolerance is distinct from the original
absolute product targets: the command retains the current run's absolute verdict,
and cannot turn a missed target into a pass. Human review is required to revise
product targets; no revision is made here. Baselines include desktop variability,
so investigate and rerun before accepting/rejecting changes based on one ratio.

## Published baseline — 2026-10-17

Measured on CachyOS Linux 7.2.9-2, Python 3.11.14, Ryzen 5 **5600X** / 12 logical
CPUs, approximately 32 GB RAM, powersave governors and all 12 CPUs available.
The architecture's nominal CPU is a 5600; these measurements identify the actual
5600X. PCI inspection identifies AMD Navi 48 (`1002:7550`, RX 9070 family);
Ollama's loaded inventories record GPU placement/bytes independently from speech.
This was an uncontrolled logged-in desktop with other applications/compositor
running. Lightweight editing, type/lint checks and focused tests occurred during
collection; there was no deliberately imposed CPU/GPU stress. Repeat in a quiet,
controlled session before treating small differences as significant.

Production speech: Whisper tiny INT8, CPU/two threads, German transcription;
Silero CPU/one thread, threshold 0.5, 350 ms silence, 128 ms minimum speech;
Piper Thorsten medium CPU/two intra-op threads. Exact model identities and voice
configuration hashes are embedded in each report. Runtimes: sherpa-onnx/core
1.13.8, Piper 1.3.0, soxr 1.0.0, NumPy 2.4.6. Model identity is the full digest in
the JSON, not the abbreviated name below. Each run uses 30 warm short queries,
five synthetic cases repeated six times, with no tools and bounded follow-up
history. All 60 turns contain endpoint, final recognition, first token, first TTS
audio, playback-start and playback-end timestamps. No conversational content is
published in those traces.

| Configuration | Quantization | Signal proxy p50 / p95 | Proxy target | Audible target | Required-concept screen |
| --- | --- | ---: | --- | --- | ---: |
| [Gemma 3 270M](../benchmarks/latency/gemma3-270m.json) | Q8_0 | 770 / 1007 ms | passed | unvalidated | 6 / 30 |
| [Llama 3 8B](../benchmarks/latency/llama3-8b.json) | Q4_0 | 1265 / 1625 ms | passed | unvalidated | 11 / 30 |

All 30 attempts per configuration completed with measured input/output signal.
The separately reported initial trials were 811 ms (Gemma, already warm from a
smoke check) and **5249 ms** (Llama, newly loaded for this run). The Llama initial
trial exceeds both warm-target numbers; it is disclosed separately and excluded
from the warm distribution according to the predeclared procedure. This is not a
controlled cold percentile. Llama's warm snapshot also contains the previously
loaded Gemma (about 306 MiB Ollama-reported VRAM); Llama itself is about 4522 MiB.
The snapshots document that condition rather than pretending it was unloaded.
Both models use context 2048, output cap 64 tokens, temperature 0 and seed 42.

**No conversational model is selected from these results.** Llama improved the
narrow screen at additional latency, but both scores are poor. Five repeated cases,
current Whisper errors, generated-token caps and a required-word screen cannot
establish German conversational usefulness. Before choosing a production model,
complete human ratings, contextual follow-ups, inspect recognition errors through
consented temporary evaluation, and compare more suitable German conversational
models/settings. Latency alone is insufficient; neither model is marked validated.

| Speech-only workload | CPU, one-core basis | Peak summed RSS | Observed dedicated speech VRAM | Coverage verdict |
| --- | ---: | ---: | ---: | --- |
| Gemma run: resident manual idle, 3 s | 0.0% | 316.5 MiB | 0 bytes | passed for sampled idle |
| Gemma run: active voice path | 14.0% | 820.2 MiB | 0 in known samples | unvalidated: 4 / 1724 unknown samples |
| Llama run: resident manual idle, 3 s | 0.0% | 315.9 MiB | 0 bytes | passed for sampled idle |
| Llama run: active voice path | 12.5% | 574.9 MiB | 0 in known samples | unvalidated: 3 / 2461 unknown samples |
| [Separate stress workers](../benchmarks/latency/concurrent.json): resident idle | 1.0% | 495.3 MiB | 0 bytes | passed, all 30 samples |
| Separate simultaneous STT/TTS stress | 396.9% | 640.9 MiB | 0 bytes | passed, all 104 samples |

The concurrent run completed 54 recognitions and 89 syntheses over approximately
ten seconds. This establishes a sampled zero-direct-VRAM baseline for the CPU
speech stress workload; it does not erase the real-path inspection gaps. Active
real-path capture processes exited during some inspections, so their strict
whole-run VRAM coverage gate remains unvalidated. No nonzero speech allocation was
observed. These unknowns are a **measurement coverage failure**, not evidence of
GPU speech inference. No absolute CPU/RAM ceiling or multi-hour idle claim is
invented from the short measurements.

Physical headset/speaker speech-end-to-audible percentiles, noisy/whisper and long
queries, controlled cold/unloaded/load scenarios, human German ratings and wake
remain **unvalidated**. The scenario table specifies their reproduction work.
Ticket #17's implementation and synthetic baseline are delivered; its physical
acceptance is ready for human measurement. Original latency targets remain
unchanged, and no physical-audibility target is marked passed.


### Resource baseline correction

A follow-up review found that the original collector could append a teardown
sample to the idle list after its summary was constructed. Each original model
report therefore contained 31 raw idle samples but declared 30. Including the
late sample also spanned the active run and changed Llama's recomputed idle CPU
from the stored 0% to 0.237569%, which is not a resident-idle measurement.

The corrected artifacts retain only the 30 idle samples preceding the first
active sample and recompute every resource summary from its reported sample set.
The excluded sample is preserved verbatim under `excluded_resource_samples`,
with the reason and boundary rule in `resource_correction`. This correction does
not replace any latency trial or alter latency percentiles, active resource
samples, or the three-second resident-idle figures in the table. Future runs stop
and await the collectors before constructing the report or performing cleanup.
