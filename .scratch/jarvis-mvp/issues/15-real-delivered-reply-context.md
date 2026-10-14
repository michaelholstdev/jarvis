# 15: Real playback delivery in follow-up context

**What to build:** Interrupt a real spoken answer and ask a follow-up that is informed only by completed exchanges and the portion of the interrupted reply actually delivered.

**Blocked by:** 10: Local Ollama voice conversations.

**Status:** ready-for-agent

- [ ] Real audio playback exposes delivery evidence correlated with the active reply rather than treating generated text, queued audio, or completed synthesis as heard speech.
- [ ] Stopping or replacing during real playback retains only delivered reply content and earlier completed exchanges; unanswered canceled questions and unheard remainders stay out of future inference context.
- [ ] The next real/fake Ollama request proves the permitted context, including interruption before any output, during a sentence, and near playback completion.
- [ ] Late delivery/completion events after cancellation or session closure cannot add context or alter a new turn; lock/mute cleanup also clears delivery tracking.
- [ ] Document measured delivery-to-text tracking precision and its limitations for the chosen voice/player rather than claiming exactness without evidence.
- [ ] Deterministic delivery reports test conversation rules; a real synthesis/playback interruption test validates adapter tracking independently.
- [ ] Document the exact interruption/follow-up demonstration, relevant playback settings, observable diagnostics without content logging, and any supported tracking limits.
