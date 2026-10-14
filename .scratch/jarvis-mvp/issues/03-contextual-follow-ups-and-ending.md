# 03: Contextual follow-ups and explicit ending

**What to build:** Ask a scripted follow-up without reactivation, receive a context-informed answer, and end the conversation by silence or a standalone German end phrase.

**Blocked by:** 02: Manual activation through a scripted answer.

**Status:** ready-for-agent

- [x] The follow-up window defaults to 20 seconds, is configurable from 5 to 60 seconds, and starts after playback completion rather than transcript or generation completion.
- [x] Completed exchanges inform the next inference request; a valid turn receives its next window only after its reply finishes.
- [x] Speech beginning before the deadline has a documented bounded recognition-completion allowance; noise or empty recognition cannot renew the original deadline.
- [x] If empty/malformed recognition finishes after the original deadline, the conversation closes rather than automatically retrying or opening a new window.
- [x] Standalone “Danke Jarvis, das war's”, “Gespräch beenden”, and “Gute Nacht Jarvis” deterministically close the conversation before LLM interpretation; quoted/embedded control words remain question content.
- [x] Closure clears temporary audio and context, returns to activation readiness, and produces a distinct configurable end sound enabled by default.
- [x] Fake-clock tests cover long playback, near-deadline speech, silence, repeated noise, empty results, configuration boundaries, and explicit end; document the user-visible commands and timer rules.


## Answer

Implemented contextual scripted conversations at the existing public core seam.
Playback completion opens a configurable follow-up window; inference receives
bounded completed-exchange history. Speech onset before the original deadline
permits recognition until the earlier of the utterance limit or the original
deadline plus the configured recognition allowance (5 seconds by default).
Repeated onset and empty/malformed recognition cannot renew the window.
Standalone German end phrases bypass inference, clear transient context/reply,
and request mock audio cleanup with an independently configurable end sound.
The CLI supports follow-ups without activation; README documents commands and
timer rules. Sounds, recognition and playback remain simulated.

## Comments

Validation: `npm run check` and `npm test` passed (20 Node tests, 3 Python tests).
Checks/socket tests ran outside the filesystem sandbox for dependency cache and
local Unix-socket access. Typechecking also passed after the shared exchange
type cleanup.

Standards review: no documented violations; resolved the optional duplicated
exchange-shape suggestion with `ConversationExchange`.
Spec review: no findings or scope creep. Real acoustic validation remains open.
