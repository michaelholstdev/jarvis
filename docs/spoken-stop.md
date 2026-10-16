# Spoken stop (FR-09)

`features.voice_stop: true` opts into experimental local recognition during answer
playback in `audio.mode: voice`. Default is **false**. Restart both services after
changing configuration. General barge-in remains disabled. Use CLI `stop` to
silence playback, or `activate` to cancel and ask a replacement question, whether
voice stop is enabled, disabled, missing its models, or unreliable.

Reuse the pinned CPU Whisper tiny INT8/Silero installation in
[audio-input.md](audio-input.md), including its exact download/checksum commands,
`config/models.json`, `uv.lock`, and MIT/Apache-2.0 model/runtime notices. Piper
and voice provenance/licenses are in [audio-output.md](audio-output.md). No new
model, package, cloud recognition or automatic download is introduced.

## Scope and limits

Playback-scoped control capture uses the existing resident recognizer. It uses the selected
physical microphone, rejecting sink monitors, with two-second capture windows,
128 ms pre-roll, Silero threshold 0.5, minimum speech 128 ms, and configured silence
(default 350 ms). No idle capture, general question routing, saved recordings or
transcript logging. Control recognition ends after one stop and starts no further windows
following 60 seconds. Model memory stays resident between turns. Playback completion
signals capture cancellation and waits for cleanup; a native decode may delay
completion. The owning operation's fixed watchdog kills the worker process group,
including capture children, if it stalls. Lock, mute, manual cancellation and socket
disconnect also destroy that group. Answer synthesis is capped at 60 seconds.
Windows can miss speech before the initial silence boundary or between
capture/decoding passes. This endpointed backend is deliberately provisional.

Only a complete endpointed standalone `Stopp` (case and final punctuation allowed)
can produce a control event. Every control capture window first requires at least
350 ms (or the configured longer end silence) of VAD silence before accepting a
new speech onset. This also discards ongoing speech after a truncated window, so
the trailing word of an embedded phrase cannot become a standalone command.
Quotation marks, extra words, truncated windows, empty recognition and VAD activity
cannot establish intent. The actual synthesized PCM is resampled to
16 kHz and compared with each captured utterance using normalized correlation at
4 kHz with a provisional 0.35 echo veto. Replies containing the word `Stopp`
disable detection for that answer entirely, preserving the manual fallback.
Correlation can miss nonlinear/reverberant echo and reject a user's simultaneous
speech. Background voices can still resemble a command. This is **not validated
speaker separation or acoustic echo cancellation**; no general barge-in claim.
Do not enable for routine use until that device setup passes acoustic trials.

The core receives a content-free, operation-scoped control event, cancels the reply,
ignores late events and opens the default 20-second follow-up window only after
cancellation acknowledgment. Expiry still takes priority where applicable. Context
retains fully drained sentence prefixes; a partly heard current sentence is omitted
because its delivered position cannot be established accurately. Synthesis and
playback are bounded; no undelivered remainder is added to context. This sentence
precision also improves manual cancellation. Opening a new output stream per sentence
may introduce pauses; measure intelligibility and stop latency on actual devices.

## Reproducible acoustic trials

Run deterministic checks first:

```sh
npm run check
npm test
.venv/bin/python -m unittest discover -s tests -p stop_control_test.py
```

With both services stopped, use the existing configured physical mic/sink and model
paths; install input/output extras as described in the input guide. The explicit
trial command opens the microphone and plays fixed text through the selected output:

```sh
.venv/bin/python scripts/verify-stop.py --setup headset --case positive
.venv/bin/python scripts/verify-stop.py --setup headset --case assistant-stop
.venv/bin/python scripts/verify-stop.py --setup headset --case background
# Repeat each command with --setup speakers and that setup's stable devices.
```

`tests/fixtures/spoken-stop/cases.json` supplies exact German Piper text and
instructions; reports include the fixture checksum. Keep stdout reports privately;
they contain device names/settings but no captured speech. Use at least 30 positive
trials per setup, varying quiet/normal speech and overlap timing (early, middle,
late); run at least 30 minutes of negative trials across assistant speech and
representative background TV/music/German speech. Repeat negative fixtures with
no human stop. Record background file hashes/source/license, volume, distance,
room, headset model, PipeWire settings, hardware, model hashes and revision.
Do not substitute synthetic correlation tests for acoustic trials.

The console cue is a reproducible instruction, **not speech onset**. Measure actual
speech onset and audible playback cessation with an independently consented local
recording or synchronized fixture feed. Align to the printed `trial_start` monotonic
time. `--onset-ms` can annotate a known fixture onset; otherwise response delay stays
null. Script detection delay ends at the control event and excludes final playback
cancellation/drain latency: measure the audible tail separately. Compute recall
(detected/attempted), p50/p95 onset-to-silence, and false stops/hour. Keep raw trials
and aggregate per setup; report missing measurements as unvalidated.

Provisional acceptance targets: ≥95% recall, p95 onset-to-silence ≤1500 ms, zero
false stops in the documented ≥30-minute negative set, independent manual cancellation
and lock/mute checks. These are trial criteria, not measured performance guarantees.
Failures require `voice_stop: false` for that setup; preserve manual controls. A
manual-only test never passes spoken FR-09.

| Setup | FR-09 | Recall | p50/p95 onset-to-silence | False stops/hour |
| --- | --- | --- | --- | --- |
| Actual headset | **unvalidated** | not measured | not measured | not measured |
| Actual speakers | **unvalidated** | not measured | not measured | not measured |

No physical acoustic trial was performed for ticket #14. Automated checks establish
control validation, synthetic delayed/scaled echo rejection, operation identity,
manual fallback and cancellation semantics only. FR-09 remains a release gap for
both setups until the above evidence is collected.
