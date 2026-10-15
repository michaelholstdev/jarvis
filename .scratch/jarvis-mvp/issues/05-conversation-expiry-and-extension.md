# 05: Conversation expiry and explicit extension

**What to build:** Continue a conversation beyond its normal allowance only after Jarvis finishes the current turn and you explicitly agree to an extension.

**Blocked by:** 03: Contextual follow-ups and explicit ending.

**Status:** ready-for-agent

- [x] The configurable conversation allowance defaults to five minutes and is distinct from the inactivity follow-up window.
- [x] Expiry during a healthy turn allows that turn to finish, then plays a brief extension prompt instead of opening another normal follow-up window.
- [x] Expiry between turns prompts immediately; the extension response window starts after the prompt ends and defaults to 20 seconds.
- [x] During that window only explicit extension/end commands are accepted; a normal question cannot silently renew the conversation or trigger inference.
- [x] Standalone “Weiter” grants five more minutes with existing context; silence or an end phrase closes and clears the conversation.
- [x] Separate stalled-operation watchdog recovery may interrupt stalled work and does not redefine normal finished-turn expiry.
- [x] Fake-clock tests cover expiry during listening/thinking/playback, expiry between turns, prompt timing, renewal, ignored normal questions, and silence cleanup; document configuration and extension commands.


## Answer

Implemented a conversation allowance separate from inactivity and operation
watchdogs. Healthy turns finish before an explicit extension prompt; expiry
between turns prompts immediately. Prompt delivery starts a strict configurable
extension response window. Only standalone Weiter renews the allowance while
retaining delivered context. End phrases or silence clear the conversation;
normal questions, quoted commands, onset and manual activation cannot bypass
extension. Stop/replacement completing after expiry also require extension.
The daemon ticker drives prompt synthesis/playback, and scripted CLI commands
exercise the extension flow over the shared protocol and Python audio mock.
README, configuration and protocol docs describe the rules and existing timer
settings. Speech and audible prompts remain simulated pending later milestones.

## Comments

Validation: fake-clock tests cover the healthy turn phases, between-turn expiry,
prompt timing, strict command gating, configurable renewal, silence/context
cleanup, cancellation boundaries, stale events and separate watchdog behavior.
A real daemon/Python socket integration exercises automatic expiry with no CLI
request, then explicit renewal and contextual follow-up. Configuration tests
cover defaults and integer bounds. Review baseline: 3375328.


### Review and final validation

Standards review found one incomplete map pointer; #05 is now resolved in the
implementation map with an Answer link and #06 is next. Spec review found one
P2: an end command arriving exactly at allowance expiry could be displaced by
the prompt transition. End commands now take priority over timer reconciliation
while stale operation IDs remain rejected. Red/green regression tests cover all
three end phrases and cleared context. Both independent review follow-ups report
zero open findings.

Final validation: `npm run check` and `npm test` pass (51 Node tests, 3 Python tests).
