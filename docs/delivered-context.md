# Delivered reply context

Follow-up inference receives earlier completed exchanges and only the confirmed
prefix of an interrupted spoken reply. With no confirmed speech, its question is
also omitted. Generated text, completed synthesis and queued PCM provide no delivery
evidence. Explicit text viewing does not add the unheard remainder to context.

The current Piper/Pulse adapter uses **whole synthesized sentences**, including
following whitespace, rather than estimated words. Each sentence is synthesized
separately, resampled, played on the configured sink, and confirmed only after
`pa_simple_drain` succeeds. No text position is inferred from elapsed time. This
conservatively omits the current sentence, possibly nearly all of it, at cancellation.
A long sentence can therefore lose substantial heard context. Abbreviations can
create shorter segments; punctuation is a segmentation heuristic, not linguistic
alignment. There is no word or phoneme accuracy claim.

Delivery evidence is correlated with the active play operation. Counts are
monotonic UTF-16 offsets (matching TypeScript string slicing). Cancellation consumes
the matching operation's count once, including after the play socket disconnects.
New work, failure, normal cleanup and lock/mute erase tracking. Late results cannot
modify a newer turn or reopen a closed session. Privacy clears earlier context too.

## Repeatable checks

Install the pinned CPU Piper 1.3.0/Thorsten medium voice, libpulse, pactl and soxr
using [audio-output.md](audio-output.md). `parec` from the PulseAudio client tools is
also required for the independent monitor measurement. No new model is needed.

```sh
npm run build
node --test dist/tests/delivered-context.test.js
.venv/bin/python -m unittest discover -s tests -p output_test.py
.venv/bin/python scripts/verify-delivery.py /absolute/path/to/de_DE-thorsten-medium.onnx
```

The request test runs a loopback fake Ollama server and socket audio fixture. It
completes `Vorher?` → `Alt.`, interrupts `Unterbrochen?` → `Eins. Zwei. Drei.`
at reported offsets 0, 6 and 12, then asks `Was habe ich gehört?`. It asserts the
actual next HTTP request contains the earlier exchange, the interrupted exchange
only when its prefix is nonempty, and the new question. It checks both stop and
replacement. Lock, mute and explicit closure instead produce a fresh request with
no prior history. Successful late completion and repeated cancellation reports
cannot change the pending new turn. Existing service-socket tests independently
cover disconnect-to-cancel delivery retention and privacy erasure.

The real adapter probe creates and removes a dedicated **silent** 48 kHz null sink,
uses `audio.mode: piper`, disables voice stop, and never opens the physical mic or
output. It speaks the synthetic fixture:

> Berlin ist die Hauptstadt. München liegt in Bayern. Hamburg hat einen Hafen.

The probe seeds ONNX Runtime with 42 only inside its reference session and its
worker launcher. It keeps the production synthesis settings and real playback
implementation. A separate inference session synthesizes each of the three literal
fixture sentences and resamples it to 48 kHz. Those reference sample counts and
waveforms establish the sentence boundaries before any adapter report is observed.
The seeded fixture is reproducible; ordinary production synthesis remains stochastic.

First it completes playback, then repeats synthesis and interrupts before play,
700 ms into the first sentence, 700 ms after the first drained prefix, and 350 ms
before measured baseline completion. Three more trials cancel immediately after
reports 27, 52 and 76. Baseline elapsed time selects only the late-interruption time;
it never supplies the expected PCM or validates a delivery claim.

Independent `parec` capture of only the null sink's monitor stays in bounded memory.
Every delivery callback freezes its current capture as an immutable snapshot.
Afterward the probe locates each expected sentence waveform in that snapshot in
order, requiring normalized correlation ≥0.9999. Stream startup/gaps and constant
output gain are allowed. At most the final **20 ms of each reference sentence** is
excluded to account for the 10 ms capture frames and reader scheduling. This is a
fixed measurement tolerance, not permission to omit an arbitrary percentage of
speech. Reports need the actual waveform, rather than enough amplitude activity;
later captured PCM cannot rescue a premature report. Missing/wrong reference PCM
fails closed. Any seed/runtime/device mismatch requires inspection, not widening
the waveform threshold. PCM is discarded, and reports contain counts/times only.
No physical microphone is opened and no ambient speech is recorded.

A negative control leaves real synthesis/playback/drain unchanged but falsely emits
offset 52 at 900 ms into the second sentence. This command must exit nonzero with
`AssertionError: unobserved sentence PCM`:

```sh
.venv/bin/python scripts/verify-delivery.py /absolute/path/to/de_DE-thorsten-medium.onnx --inject-premature-report
```

The comparator regression checks use known source waveforms and a frozen capture
missing the final 490 ms of the second sentence. They also check wrong/silent PCM,
the fixed 20 ms tolerance, and that later audio does not validate an earlier report:

```sh
.venv/bin/python -m unittest discover -s tests -p delivery_probe_test.py
```

This validates adapter tracking independently of its reports. It does not establish
physical audibility or exact word alignment.

## Measured precision and limits

2026-10-16, this development host's PipeWire/Pulse session, pinned Thorsten medium,
CPU provider with two inference threads, 22050 → 48000 Hz soxr, mono signed 16-bit,
20 ms writes and per-sentence drain. Reference seed 42 produced sentence sample
counts **67988 / 63530 / 62973**, corresponding to approximately
**1416 / 1324 / 1312 ms** at 48 kHz. One full baseline and seven cancellation trials
passed the independent waveform comparisons:

| Trial | Retained UTF-16 chars | Monitor active audio | Elapsed including cancellation/validation |
| --- | ---: | ---: | ---: |
| Full | 76 | 3488 ms | 4190 ms |
| Before output | 0 | 0 ms | 7 ms |
| During first sentence | 0 | 587 ms | 859 ms |
| During second sentence | 27 | 1766 ms | 2311 ms |
| Near completion | 52 | 3271 ms | 4026 ms |
| Immediately after report 27 | 27 | 1162 ms | 1610 ms |
| Immediately after report 52 | 52 | 2313 ms | 2984 ms |
| Immediately after report 76 | 76 | 3488 ms | 4343 ms |

Baseline offsets 27/52/76 arrived at 1449/2798/4131 ms. Their frozen capture
snapshots matched the separately synthesized sentence PCM within the fixed 20 ms
capture-lag tolerance. The premature-offset-52 negative control was rejected with
`unobserved sentence PCM`; no report-derived baseline was used for that decision.

Active monitor audio counts samples above amplitude 32/32768 for diagnostics only;
these totals are not the delivery oracle and do not count intelligible words.
Elapsed times include control/analysis work and are not acoustic stop latency.
These are fixture measurements, not a general error bound or latency percentile.
A nearly completed current sentence can still be omitted entirely. The probe has
no hardware/acoustic measurement, and server drain cannot prove that a person
heard speech. Device mute, hardware buffers and already submitted tails still need
actual headset/speaker validation. Repeated statistical measurements and word
alignment remain unsupported.

## Manual interruption and follow-up demonstration

Use the real voice/Ollama setup in [ollama.md](ollama.md), stable physical sink and
mic names, the pinned models, `features.voice_stop: false`, and the default 20 s
follow-up window. Keep both services on the same configuration. Activate with:

```sh
node dist/apps/core/main.js activate
```

Ask: “Nenne drei deutsche Städte. Sage zu jeder Stadt einen kurzen Satz.” After
hearing a complete sentence and part of the next, run in another terminal:

```sh
node dist/apps/core/main.js stop
```

Within 20 seconds ask: “Welche Städte hast du mir bisher genannt?” Repeat using
`activate` during speech for a replacement question; wait for its acknowledgment
before asking. Repeat an early stop before speech and a late stop near completion.
The current sentence may be missing from the answer: that is the documented
conservative precision. Ollama's wording is nondeterministic; use the HTTP fixture
assertions above as the exact context proof. This manual hardware demonstration was
not run here and is **unvalidated**, separately for headset and speakers.

Observe audio `playback_started`, `playback_completed`, `playback_delivered`
(operation ID plus character count), and `playback_cancelled`, and core
`operation_started`/`playback_completed` events. Audio completion events occur per
sentence; the final play result ends the whole reply. Counts from synthesis alone
never appear as delivery. Do not enable content logging or dump routine inference
requests to diagnose this behavior. `health` shows state and capability status.
