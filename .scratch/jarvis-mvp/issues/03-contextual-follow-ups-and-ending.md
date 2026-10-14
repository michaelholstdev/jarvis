# 03: Contextual follow-ups and explicit ending

**What to build:** Ask a scripted follow-up without reactivation, receive a context-informed answer, and end the conversation by silence or a standalone German end phrase.

**Blocked by:** 02: Manual activation through a scripted answer.

**Status:** ready-for-agent

- [ ] The follow-up window defaults to 20 seconds, is configurable from 5 to 60 seconds, and starts after playback completion rather than transcript or generation completion.
- [ ] Completed exchanges inform the next inference request; a valid turn receives its next window only after its reply finishes.
- [ ] Speech beginning before the deadline has a documented bounded recognition-completion allowance; noise or empty recognition cannot renew the original deadline.
- [ ] If empty/malformed recognition finishes after the original deadline, the conversation closes rather than automatically retrying or opening a new window.
- [ ] Standalone “Danke Jarvis, das war's”, “Gespräch beenden”, and “Gute Nacht Jarvis” deterministically close the conversation before LLM interpretation; quoted/embedded control words remain question content.
- [ ] Closure clears temporary audio and context, returns to activation readiness, and produces a distinct configurable end sound enabled by default.
- [ ] Fake-clock tests cover long playback, near-deadline speech, silence, repeated noise, empty results, configuration boundaries, and explicit end; document the user-visible commands and timer rules.
