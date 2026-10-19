# 22: Parakeet end phrase reaches the LLM instead of closing

**Type:** Bug

**Status:** ready-for-agent

**Claimed by:** Codex

**Resolution:** Implemented and confirmed in one live speaker trial.

**Blocked by:** None

## Observed failure

During #17's user-selected USB Composite Device Pro / Starship speaker trial,
the user reported that the original German thank-you end phrase produced an LLM
thank-you rather than the closing cue, even with a pause after activation.
The shorter explicit end command closed with an audible cue.

The live transcript was not retained. A separate synthetic reproduction using
pinned CPU Parakeet and Thorsten recognizes the intended phrase as
`Danke, Javis, das war's.`. The public Core interface treats that exact result as
`infer` rather than `close-conversation`. This proves a reproducible spelling
failure, without proving the precise transcription of the live failure.

## Acceptance criteria

- [x] Accept the observed complete standalone Parakeet spelling as an end command;
  preserve ordinary questions and quotations, without fuzzy substring matching.
- [x] Reproduce red then green through the agreed public Core interface, checking
  closure, cleared context and the enabled closing cue.
- [x] Repeat the original end phrase live with the same devices and confirm the
  closing cue; preserve failed or inconclusive observations.
- [x] Run checks, full regressions and independent Standards/Spec reviews.

## Answer

Added the exact observed standalone spelling to the finite end-phrase list.
The existing Core regression failed before the fix and passes after it, including
negative cases for quoted and embedded variants. All 17 conversation tests,
`npm run check` and full `npm test` pass (204 Node / 42 Python).

The corrected original end phrase was repeated live with the same USB microphone
and Starship output. The user confirmed a clearly audible closing cue; diagnostics
show recognition followed directly by `close-conversation`, without LLM inference.
This is one successful trial, not a general acoustic acceptance result. The exact
live transcription remains unknown; the earlier failure remains in the evidence.

Evidence: [content-free speaker smoke report](../../../benchmarks/latency/usb-starship-human-smoke.json).
The initial missing activation cue remains unexplained; this fix does not claim
to resolve it. No headset, audible latency or model-selection pass is inferred.

Map: [#17 and separate speaker acceptance](../map.md).

## Review

Independent Standards and Spec reviewers report **0 actionable findings** for
the correction and final evidence/docs. The broader #17/#21 acceptance work
remains open; the successful smoke trial does not close those tickets.
