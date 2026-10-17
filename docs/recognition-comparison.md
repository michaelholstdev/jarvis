# German CPU recognition comparison

Ticket #16 provides an opt-in, offline benchmark alongside the existing replaceable
`StreamingRecognizer` boundary. It never opens a microphone, changes the running
service configuration, downloads during inference, or writes conversation logs.
The published JSON files intentionally include **synthetic** references and hypotheses.
Do not substitute private recordings into committed results.

## Reproduce

Run from the repository root on Linux x86-64 with Python 3.11. Keep the generated
model/audio directory outside version control (`models/` is ignored).

```sh
uv sync --frozen --extra input --extra output --extra benchmark
.venv/bin/python -m benchmarks.recognition.prepare models/benchmark --download --synthesize
.venv/bin/python -m benchmarks.recognition.run whisper models/benchmark /tmp/whisper.json
.venv/bin/python -m benchmarks.recognition.run parakeet models/benchmark /tmp/parakeet.json
.venv/bin/python -m benchmarks.recognition.run vosk models/benchmark /tmp/vosk.json
.venv/bin/python -m unittest tests/recognition_benchmark_test.py
```

Installation and the explicit `--download` step require internet; synthesis and all
three benchmark runs are local. `prepare` verifies every source against
[artifacts.json](../benchmarks/recognition/artifacts.json) **before** extraction or
loading. It copies only regular ONNX/token files from the sherpa archives and rejects
traversal in the Vosk archive. Without `--download`, missing artifacts fail. A bad
checksum always fails; remove the bad local artifact and repeat the explicit download.
The resulting `verified-models.json` records extracted-file hashes. Each run verifies
the selected files and all WAVs before inference and embeds the inventory in its
report. Archive checksums are the authoritative identity of the export; filenames
alone are insufficient. Wheel versions and hashes are pinned in `uv.lock`; the
report records that lockfile's hash and installed runtime versions. In these initial
reports, `revision` identifies the task-start parent commit: the benchmark tooling
and evidence were still uncommitted during measurement. Use the commit containing
this report to locate the implemented harness, rather than checking out that parent
and expecting the benchmark to exist.

The [corpus source](../benchmarks/recognition/corpus.json) contains 20 standard German
questions/follow-ups and 10 German questions with English technical terms, plus one
each for dialect-like wording, longer dictation, and language switching. These are
original evaluation sentences, not human recordings. Piper Thorsten medium at the
pinned voice revision renders all sentences with `noise_scale=0`, `noise_w_scale=0`,
`length_scale=1`, CPU inference, then soxr resamples to mono PCM16 at 16 kHz. No
silence or noise is added. The generated corpus manifest records every WAV hash,
length, reference and synthesis setting. Regeneration can vary with platform/runtime;
compare its hashes with the corpus embedded in the published JSON before claiming
bit-identical input. Run all recognizers on the same generated directory.

For future human recordings, obtain explicit consent covering retention and sharing,
record device/environment provenance, and publish a separate versioned corpus and
report. A TTS voice reading dialect-like words is **not authentic dialect evidence**.
This single clean male synthetic voice cannot establish accent, room, headset,
speaker, whisper, noise, spontaneous-speech or population accuracy.

## Method and screening gate

The gate was fixed before the measurements: at least 30 distinct core utterances,
standard German corpus WER ≤15%, technical corpus WER ≤25%, core p95 decoding compute
≤1000 ms and aggregate real-time factor ≤1. It is a provisional recognizer screening
gate, separate from the product's end-of-speech-to-audible-answer latency target and
from acoustic release acceptance. If no configuration passes, retain the existing
backend only as provisional and explicitly leave recognizer selection unvalidated.
Among passing configurations, prefer the lowest core WER, using compute latency as
a tie-breaker. Capability probes never affect this gate.

Scoring uses NFC Unicode, lowercase and punctuation replaced with spaces; umlauts,
ß, compounds and digit/word distinctions remain significant. There are no aliases
for technical terms or post-hoc transcript corrections. WER is total word edit
distance divided by total reference words; CER uses normalized characters including
spaces. Exact match compares the full normalized utterance. Percentiles use nearest
rank. RTF is summed decode time divided by summed audio duration. Three measured
passes follow one first-utterance warm-up; repeated observations do not increase
the number of distinct gate utterances. JSON preserves individual hypotheses,
measurements and group summaries for independent auditing.

Whisper tiny INT8 uses the actual application's `WhisperRecognizer`, CPU, two threads,
German transcription. Parakeet uses sherpa-onnx's offline NeMo transducer, CPU, two
threads, greedy search, INT8 encoder/decoder/joiner and automatic language detection.
Both receive the **complete** utterance and return one final result. Neither is
true partial streaming in this experiment. Vosk small German uses its CPU defaults
and accepts successive 20 ms PCM chunks with incremental partials; this is a genuine
streaming alternative. Its measured decode time includes all chunk processing,
partial polling, intermediate results and final flush. Vosk threads are not
configured by this harness; it is not an equal-thread architecture comparison.

All input is unpaced: compute time and RTF measure throughput, not simulated live
wall-clock responsiveness. Vosk's first partial **audio offset** is the amount of
input consumed before a nonempty partial, not elapsed real-time latency. Its final
flush time is recorded separately. Whole-utterance final latency excludes capture,
VAD/end-silence, sockets, LLM and TTS; do not compare a Vosk final flush alone with an
offline model's full decode. No production VAD threshold is calibrated here.

Runs are sequential, with a fresh process/model per configuration. Load time and
the first decode are recorded separately (OS file caches may already be warm).
Peak RSS is process high-water memory, not idle service memory. CPU time and elapsed
measurement time are aggregate observations. Hardware snapshots record CPU identity,
CPU affinity, governors, memory, system load, Ollama processes and available GPU VRAM
counters. Desktop background activity is uncontrolled. Total GPU counters include
other applications and do not attribute allocation to speech; CPU providers are
explicitly selected, but dedicated speech VRAM is not independently measured.

## Sources and compatibility

The [sherpa NeMo export guide](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)
provides the Parakeet TDT v3 INT8 artifact. The
[NVIDIA model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) lists German
among its languages and CC-BY-4.0 terms; the tested artifact is the pinned sherpa
ONNX export, not NVIDIA's native NeMo runtime. Preserve attribution when distributing.
[Alpha Cephei's model list](https://alphacephei.com/vosk/models) identifies
`vosk-model-small-de-0.15` as a small German model under Apache-2.0;
[Vosk's example](https://github.com/alphacep/vosk-api/blob/master/python/example/test_simple.py)
documents incremental waveform/result processing. Vosk is not an ONNX INT8 model.
Whisper uses the existing [input provenance](audio-input.md); Thorsten uses the
existing [voice provenance](audio-output.md), including the pinned MODEL_CARD and
Piper's GPL runtime terms. These upstream descriptions are not local measurements.

Other OS/CPU/runtime versions, GPU inference, concurrent Ollama generation,
real-time capture, authentic dialects, prolonged dictation and broad multilingual
support remain unvalidated. Benchmark-only Parakeet/Vosk adapters do not register
new production configuration IDs. The replaceable `StreamingRecognizer` interface
and current service behavior remain intact; deploying another recognizer needs its
own adapter/configuration and capture/cancellation acceptance checks.

## Measured results and recommendation — 2026-10-17

**Recommend Parakeet TDT v3 INT8, CPU, two threads, greedy search as the initial
recognizer configuration for the next production adapter.** It was the only
configuration to pass the predefined synthetic gate, with substantially fewer
recognition errors than the existing Whisper backend. This is a measured selection
for clean synthetic German, not release validation or a claim that English technical
vocabulary is solved. Production still accepts only `whisper-tiny-int8`; retain that
as provisional until the chosen adapter passes service integration and acoustic checks.

Actual machine: CachyOS Linux 7.2.9-2, Ryzen 5 **5600X**, 12 logical CPUs, about
32 GB RAM, powersave governors, unrestricted 12-CPU affinity. The architecture names
a 5600; this report does not silently equate the two. No Ollama process was visible
in the benchmark process namespace; Ollama loaded/unloaded and concurrent generation
are not controlled conditions. GPU total VRAM snapshots include desktop applications;
there is no per-speech allocation measurement. Some lightweight development checks
ran during the uncontrolled desktop session; treat latency differences accordingly.
Runtimes: sherpa-onnx/core 1.13.8, Vosk 0.3.45, Piper 1.3.0, soxr 1.0.0, NumPy 2.4.6,
Python 3.11.14. See the raw reports for full before/after hardware state.

Thirty core utterances total 69.93 seconds of audio and 225 reference words per pass.
The tables aggregate three passes (675 reference words); those are repeat observations
of 30 inputs, not 90 independent speech samples. WER can exceed intuitive error rates
when compound spelling, technical pronunciation and TTS rendering differ from reference.

| Configuration | Standard WER | Technical WER | Core WER / CER | Exact matches | Compute p50 / p95 | RTF | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| [Parakeet v3 INT8](../benchmarks/recognition/parakeet.json) | 0.7% | 16.7% | 6.7% / 2.0% | 76.7% | 191 / 246 ms | 0.083 | pass |
| [Whisper tiny INT8](../benchmarks/recognition/whisper.json) | 24.1% | 39.3% | 29.8% / 11.0% | 23.3% | 208 / 265 ms | 0.089 | fail: quality |
| [Vosk small German 0.15](../benchmarks/recognition/vosk.json) | 5.7% | 41.7% | 19.1% / 6.0% | 46.7% | 333 / 386 ms | 0.141 | fail: quality |

| Configuration | Model load | First decode | Peak process RSS | Dialect-like WER | Dictation WER | Language-switching WER |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| parakeet | 1769 ms | 172 ms | 1138 MiB | 30.0% | 0.0% | 50.0% |
| whisper | 288 ms | 176 ms | 346 MiB | 50.0% | 9.7% | 58.3% |
| vosk | 474 ms | 283 ms | 277 MiB | 30.0% | 3.2% | 61.1% |

The three probe columns each represent only **one synthetic utterance**, repeated
three times. The dictation probe is a short paragraph, not prolonged-dictation
validation. Language switching performs poorly for every configuration. Vosk
recognition varied slightly on the switching probe across passes; raw results retain
that variation rather than selecting a favorable run.

Parakeet examples include “Timeout” → “Team Loot”, “Cache” → “Kachel”, and “Bug” →
“Book”. Even the passing candidate needs more technical-vocabulary and human testing.
Vosk provides partial results but fails the technical-vocabulary gate; streaming
alone is insufficient evidence to choose it. Whisper fails both quality thresholds.
Keep the replaceable recognizer boundary so this decision can be revisited with a
larger, multi-speaker corpus, real endpoints and loaded-Ollama measurements.

All three tested configurations were compatible with this Linux CPU environment.
No compatibility failure or missing configuration has been assigned invented numbers.
Unmeasured platforms, configurations and acoustic conditions remain unvalidated.
