# 04: Manual replacement and delivered-reply context

**What to build:** Change your mind while Jarvis is thinking or speaking, activate a replacement question, and continue from earlier exchanges and only the reply you actually heard.

**Blocked by:** 03: Contextual follow-ups and explicit ending.

**Status:** ready-for-agent

- [ ] Manual activation during thinking cancels generation and accepts a replacement question after acknowledgment; the unanswered canceled question is excluded from future context.
- [ ] Manual activation during speaking cancels playback and remaining reply work, then listens after acknowledgment while retaining completed exchanges and delivered speech.
- [ ] A manual stop-playback control silences the current reply without ending the conversation and opens the normal follow-up window when playback stops; it is distinct from activation for a replacement question.
- [ ] The context supplied to subsequent inference excludes unheard reply remainders and uses scripted delivery reports rather than assuming generated or synthesized text was heard.
- [ ] Late recognition, inference, synthesis, and playback events from canceled operations cannot deliver replies, alter context, or advance the newer turn.
- [ ] Standalone stop-playback semantics are testable through a recognized control event; acoustic recognition during playback is reserved for the separate spoken-stop ticket.
- [ ] Public-boundary tests cover thinking/playback cancellation, partial/no delivery, stale results, and follow-up context; document CLI stop versus replacement versus end behavior.
