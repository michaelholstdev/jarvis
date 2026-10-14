# 05: Conversation expiry and explicit extension

**What to build:** Continue a conversation beyond its normal allowance only after Jarvis finishes the current turn and you explicitly agree to an extension.

**Blocked by:** 03: Contextual follow-ups and explicit ending.

**Status:** ready-for-agent

- [ ] The configurable conversation allowance defaults to five minutes and is distinct from the inactivity follow-up window.
- [ ] Expiry during a healthy turn allows that turn to finish, then plays a brief extension prompt instead of opening another normal follow-up window.
- [ ] Expiry between turns prompts immediately; the extension response window starts after the prompt ends and defaults to 20 seconds.
- [ ] During that window only explicit extension/end commands are accepted; a normal question cannot silently renew the conversation or trigger inference.
- [ ] Standalone “Weiter” grants five more minutes with existing context; silence or an end phrase closes and clears the conversation.
- [ ] Separate stalled-operation watchdog recovery may interrupt stalled work and does not redefine normal finished-turn expiry.
- [ ] Fake-clock tests cover expiry during listening/thinking/playback, expiry between turns, prompt timing, renewal, ignored normal questions, and silence cleanup; document configuration and extension commands.
