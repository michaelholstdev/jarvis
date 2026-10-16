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

First it completes playback, then repeats synthesis and interrupts before play,
700 ms into the first sentence, 700 ms after the first drained prefix, and 350 ms
before the measured baseline completion time. Piper is stochastic; these timing
assertions can fail on another host. A failure requires inspection/remeasurement,
not silently widening the expected prefix. Independent `parec` capture of only the
null sink's monitor stays in memory and counts samples above amplitude 32/32768.
Assertions require real partial audio, exclude complete playback, and compare
retained prefixes with baseline monitor activity (15% synthesis variability
allowance). This validates adapter tracking independently of the core's reports;
it does not establish acoustic audibility or exact word alignment. PCM is discarded,
and reports contain counts/times only. There is no recording of ambient speech.

## Measured precision and limits

2026-10-16, this development host's PipeWire/Pulse session, pinned Thorsten medium,
CPU provider with two inference threads, 22050 → 48000 Hz soxr, mono signed 16-bit,
20 ms writes and per-sentence drain. One full baseline and four interruption trials:

| Trial | Retained UTF-16 chars | Monitor active audio | Elapsed including cancellation/tail collection |
| --- | ---: | ---: | ---: |
| Full | 76 | 3480 ms | 4351 ms |
| Before output | 0 | 0 ms | 7 ms |
| During first sentence | 0 | 401 ms | 858 ms |
| During second sentence | 27 | 1657 ms | 2274 ms |
| Near completion | 52 | 3211 ms | 4160 ms |

Baseline drained offsets 27/52/76 arrived at 1636/3028/4350 ms. The two
later interruptions retained exactly the preceding sentence boundary; even near
completion the last 24 characters stayed out. Partial speech omitted during the
first trial included 401 ms of active monitor audio. Sentence drain intervals in
this baseline were approximately 1.64/1.39/1.32 seconds, including startup/stream
pauses. These are fixture measurements, not a general error bound or latency
percentile. Monitor activity excludes silence and does not count intelligible words.
The probe has no hardware/acoustic measurement, and server drain cannot prove that
a person heard speech. Device mute, hardware buffers and already submitted tails
still need actual headset/speaker validation. Repeated statistical measurements and
word alignment remain unsupported.

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
