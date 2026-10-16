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

Implemented on the current branch in `4f11b2d`, with review correction
`465f0d6`.

- Local generation defaults to concise German and follows explicit detail
  requests. Speech omits fenced/indented code and Markdown pipe tables, keeping
  prose and adding a German notice for deliberate CLI text access.
- Formatted-only answers request one bounded, cancellable, content-bearing prose
  summary from the same model. Unusable summaries fail through explicit retry;
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
The final `npm run check` passed. The full `npm test` passed **167 Node tests
and 9 Python tests**, including deterministic fake model and mock-audio checks
through the running daemon and CLI. No real model quality, hardware speech or
latency claim is made.

Independent Standards and Spec reviews used baseline
`2aacf60451dc95d3f73790bdc699c5c44f13aa1e`. The initial Spec finding about
formatted-only summaries was fixed in `465f0d6`; re-reviews returned
**Standards: 0 findings; Spec: 0 findings**.

Map pointer: [implementation map](../map.md).
