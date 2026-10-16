# 15: Real playback delivery in follow-up context

**What to build:** Interrupt a real spoken answer and ask a follow-up that is informed only by completed exchanges and the portion of the interrupted reply actually delivered.

**Blocked by:** 10: Local Ollama voice conversations.

**Status:** ready-for-agent

**Claimed by:** Codex (completed).

- [x] Real audio playback exposes delivery evidence correlated with the active reply rather than treating generated text, queued audio, or completed synthesis as heard speech.
- [x] Stopping or replacing during real playback retains only delivered reply content and earlier completed exchanges; unanswered canceled questions and unheard remainders stay out of future inference context.
- [x] The next real/fake Ollama request proves the permitted context, including interruption before any output, during a sentence, and near playback completion.
- [x] Late delivery/completion events after cancellation or session closure cannot add context or alter a new turn; lock/mute cleanup also clears delivery tracking.
- [x] Document measured delivery-to-text tracking precision and its limitations for the chosen voice/player rather than claiming exactness without evidence.
- [x] Deterministic delivery reports test conversation rules; a real synthesis/playback interruption test validates adapter tracking independently.
- [x] Document the exact interruption/follow-up demonstration, relevant playback settings, observable diagnostics without content logging, and any supported tracking limits.


## Answer

Implemented and verified using the existing whole-sentence drain boundary added
in #14. Delivery evidence now exposes a validated public observer and content-free
operation-scoped character counts; regressing worker evidence fails closed and
erases tracking. Context remains conservative: a partly heard current sentence
is omitted, never guessed from generated text or elapsed time.

Fifteen public runtime/fake Ollama HTTP scenarios verify the exact next request
for stop/replacement at offsets 0/6/12, earlier completed history, exclusion of
unanswered questions and unheard remainders, stale completions, lock/mute and
closure. Existing service-socket checks cover disconnect retention and erasure.

The independent real Piper/Pulse probe passed a full baseline plus interruptions
before output, in the first and second sentences, and near completion. A temporary
48 kHz silent sink monitor independently observed partial PCM; retained counts
were 0/0/27/52. No physical microphone/output was used. See the
[delivery guide](../../../docs/delivered-context.md) for exact fixtures, measured
sentence granularity, settings, diagnostics, commands, and manual follow-up demo.
Physical headset/speaker audibility and the manual demo remain **unvalidated**;
no word alignment, exact heard-text or acoustic precision claim is made.

Validation: `npm run check`, focused public-boundary tests, script Ruff check,
`git diff --check`, and final `npm test` passed (**203 Node / 19 Python tests**).
Real command: `.venv/bin/python scripts/verify-delivery.py /tmp/jarvis-thorsten.onnx`
with the manifest-pinned Thorsten medium model verified before playback.

### Standards review

Zero findings against baseline `a8882cec685657b2e638a22cef4ad19370459328`.
Approved test seams, local inference and content-free diagnostics conform to the
repo's standards and ADR validation rules.

### Spec review

Zero findings; real adapter tracking, deterministic next-request proof and precision
documentation satisfy #15. Physical headset/speaker validation is explicitly open.

Map pointer: [implementation map](../map.md).

## Review follow-up: independent playback evidence

The fresh review found one P2: the original probe's baseline used the adapter's
own delivery events, so it could accept a prematurely reported sentence prefix.
That validation gap is fixed:

- An independent seeded Piper inference session establishes the expected PCM for
  each literal fixture sentence before any delivery report. The real worker uses
  the same ONNX seed only in the probe launcher; production settings are unchanged.
- Each delivery callback freezes the monitor capture. The verifier matches source
  sentence waveforms in order against that immutable snapshot; later PCM and
  report-derived amplitude totals cannot validate a premature claim. Its fixed
  capture-lag tolerance is 20 ms per sentence, with correlation threshold 0.9999.
- Added cancellation immediately after each report (27/52/76), alongside the
  existing early/mid/late trials. All eight real silent-sink trials passed.
- A real-playback negative control emits offset 52 at 900 ms into the second
  sentence, leaving synthesis/playback/drain unchanged. The probe rejects it with
  `AssertionError: unobserved sentence PCM` (expected nonzero exit).
- Regression checks reject a source waveform missing its final 490 ms, reject
  silent PCM and a 21 ms shortfall, permit the fixed 20 ms capture tolerance,
  and prove later PCM cannot rescue an earlier frozen snapshot.

Reference seed 42 produced 67988/63530/62973 samples per sentence at 48 kHz.
Updated measurements, exact commands and limits are in the
[delivery guide](../../../docs/delivered-context.md). Physical headset/speaker
acceptance remains explicitly unvalidated.

Final validation: `npm run check`, probe/regression Ruff checks, focused regression
checks, and `git diff --check` passed. Full `npm test` passed **203 Node / 21 Python
tests**. Follow-up Standards review: **0 findings**. Follow-up Spec review:
**0 findings**; the original P2 is resolved.
