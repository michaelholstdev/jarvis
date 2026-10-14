# 04: Manual replacement and delivered-reply context

**What to build:** Change your mind while Jarvis is thinking or speaking, activate a replacement question, and continue from earlier exchanges and only the reply you actually heard.

**Blocked by:** 03: Contextual follow-ups and explicit ending.

**Status:** ready-for-agent

- [x] Manual activation during thinking cancels generation and accepts a replacement question after acknowledgment; the unanswered canceled question is excluded from future context.
- [x] Manual activation during speaking cancels playback and remaining reply work, then listens after acknowledgment while retaining completed exchanges and delivered speech.
- [x] A manual stop-playback control silences the current reply without ending the conversation and opens the normal follow-up window when playback stops; it is distinct from activation for a replacement question.
- [x] The context supplied to subsequent inference excludes unheard reply remainders and uses scripted delivery reports rather than assuming generated or synthesized text was heard.
- [x] Late recognition, inference, synthesis, and playback events from canceled operations cannot deliver replies, alter context, or advance the newer turn.
- [x] Standalone stop-playback semantics are testable through a recognized control event; acoustic recognition during playback is reserved for the separate spoken-stop ticket.
- [x] Public-boundary tests cover thinking/playback cancellation, partial/no delivery, stale results, and follow-up context; document CLI stop versus replacement versus end behavior.

## Comments

Claimed for implementation on the current branch. Review baseline: `110d6e4`.


## Answer

Implemented cancellable manual replacement through the public core and CLI.
Activation during inference, synthesis or playback requests cancellation using
a separate operation identity and waits for its final delivery report before
acknowledgment/listening. Standalone recognized `Stopp` and CLI `stop` share the
stop-playback path and open follow-up only once playback has stopped. Earlier
exchanges and delivered prefixes survive; unheard text and zero-delivery
questions do not enter inference context. Late target events and stale socket
responses/errors cannot advance replacement work. Python mock cancellation
reports its latest matching simulated playback delivery; all storage is bounded.
README and the protocol document stop/replacement/end behavior and deferred
acoustic/real-delivery validation.

Validation: `npm run check` passed; `npm test` passed (25 Node tests, 3 Python
tests). Public orchestration tests cover inference/synthesis/playback replacement,
partial/no delivery, stale events, control matching, follow-up context and timer
origin. The socket/CLI test cancels pending playback, permits a replacement
utterance before the old result arrives, and checks stale results cannot resume
work. Unix sockets and uv cache checks required sandbox escalation.

Map pointer: [implementation map](../map.md).


Review against baseline `110d6e4`: Standards — no documented violations or
reportable design smells. Spec — no missing/partial requirements, incorrect
behavior or scope creep. Both axes reviewed independently via the code-review
skill. Real acoustic stop and measured delivery remain their separate tickets.
