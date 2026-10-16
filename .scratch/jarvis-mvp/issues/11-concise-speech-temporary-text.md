# 11: Concise speech and temporary text answers

**What to build:** Hear concise German replies, request more detail, and deliberately inspect code or tables as temporary text rather than listening to unsuitable formatting.

**Blocked by:** 10: Local Ollama voice conversations.

**Status:** ready-for-agent

**Claimed by:** Codex (implementation in progress).

- [ ] Answers default to concise German and respond to explicit requests for more detail; spoken output avoids reading code blocks and large tables verbatim.
- [ ] Answers containing unsuitable spoken content receive a meaningful spoken summary indicating deliberate CLI text access.
- [ ] The CLI explicitly displays the current session's text answer without automatically saving it or adding answer/transcript/prompt content to routine logs.
- [ ] Session closure, lock, or mute clears service-side text access; inspecting text does not automatically promote an unheard generated reply remainder into follow-up context.
- [ ] Public-boundary tests use deterministic outputs containing prose, code, and tables and verify speech/text behavior, explicit detail requests, cleanup, and content-free diagnostics.
- [ ] Document exact text-viewing commands, spoken-style configuration/instructions, text lifetime, and the distinction between temporary answer access and persistent conversation history.
