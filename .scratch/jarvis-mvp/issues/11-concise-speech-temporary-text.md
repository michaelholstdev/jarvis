# 11: Concise speech and temporary text answers

**What to build:** Hear concise German replies, request more detail, and deliberately inspect code or tables as temporary text rather than listening to unsuitable formatting.

**Blocked by:** 10: Local Ollama voice conversations.

**Status:** ready-for-agent

**Claimed by:** Codex (completed).

- [x] Answers default to concise German and respond to explicit requests for more detail; spoken output avoids reading code blocks and large tables verbatim.
- [x] Answers containing unsuitable spoken content receive a meaningful spoken summary indicating deliberate CLI text access.
- [x] The CLI explicitly displays the current session's text answer without automatically saving it or adding answer/transcript/prompt content to routine logs.
- [x] Session closure, lock, or mute clears service-side text access; inspecting text does not automatically promote an unheard generated reply remainder into follow-up context.
- [x] Public-boundary tests use deterministic outputs containing prose, code, and tables and verify speech/text behavior, explicit detail requests, cleanup, and content-free diagnostics.
- [x] Document exact text-viewing commands, spoken-style configuration/instructions, text lifetime, and the distinction between temporary answer access and persistent conversation history.


## Answer

Implemented on the current branch in `4f11b2d`, with review corrections
`465f0d6` and `c5e0a8b`.

- Local generation defaults to concise German and follows explicit detail
  requests. Markdown tokenization detects fenced/indented code, including nested
  blocks, and pipe tables with short delimiter cells.
- Every answer containing code blocks or tables requests one bounded, cancellable,
  content-bearing prose summary from the same model and adds a German notice for
  deliberate CLI text access. Unusable summaries fail through explicit retry;
  there is no repeated summary loop. Original text stays separate.
- `node dist/apps/core/main.js text` deliberately prints the current answer,
  without persistence or routine logging. New accepted questions clear the old
  answer; closure, timeout, lock and software/hardware mute clear access. Reading
  never changes timers or promotes unheard content into follow-up context.
- Speech, including the CLI notice, stays within the 4096-byte limit without
  splitting Unicode code points. Ordinary prose containing a pipe is preserved.
- [Text answer guide](../../../docs/text-answers.md) documents exact commands,
  style instructions/settings, lifetime, persistent-history distinction, extra
  summary generation and model/hardware limitations. Protocol and Ollama guides
  and README link the feature.

Validation: user confirmed the conversation-controller and daemon/CLI seams.
Red/green checks covered speech separation, temporary text access, cleanup,
stopped delivery/context, near-limit output and formatted-only summaries.
The final `npm run check` passed. The full `npm test` passed **176 Node tests
and 9 Python tests**, including deterministic fake model and mock-audio checks
through the running daemon and CLI. No real model quality, hardware speech or
latency claim is made.

Independent Standards and Spec reviews used baseline
`2aacf60451dc95d3f73790bdc699c5c44f13aa1e`. The initial Spec finding about
formatted-only summaries was fixed in `465f0d6`; re-reviews returned
**Standards: 0 findings; Spec: 0 findings**.

Map pointer: [implementation map](../map.md).


## Comments

### 2026-10-16 — Post-implementation review fixes

Resolved all three findings from the fresh review against `2aacf60` in `c5e0a8b`:

- **P2 — Markdown variants reached speech:** pinned Marked `18.1.1` tokenization
  replaces the regex scan. Controller regressions cover blockquoted fences,
  two-tab indentation, list-contained fences, and short table delimiters.
- **P2 — Introductory prose bypassed meaningful summaries:** every answer
  containing code blocks or tables now requests one separate content-bearing
  prose summary. The introductory-prose regression failed before the fix and
  passed afterward. Cancellation, retry and delivered-only context are preserved.
- **P2 — Escaped text exceeded CLI frames:** text answers use UUID snapshot IDs
  and Unicode code-point offsets. Pages fit the actual encoded frame limit,
  including escaping and metadata. The CLI buffers the bounded full answer before
  printing and rejects changed/missing snapshots and invalid progress. The
  escaped-answer daemon/CLI regression failed with `frame_too_large` before the
  fix and passes afterward at frame limits of 8192 and 1024 bytes. Unicode/control
  characters survive paging; lock and replacement invalidate continuation IDs.
  Separate CLI tests verify failed continuations print no partial content.

Final validation: `npm run check` passed; `npm test` passed **176 Node tests and
9 Python tests**. Independent Standards and Spec re-reviews through `c5e0a8b`
returned **0 findings on each axis**, confirming all three issues resolved.
No real-model summary quality, physical audio or latency validation is claimed.
