# 06: Lock and mute privacy controls

**What to build:** Lock or mute Jarvis at any point to stop listening and speaking, cancel work, and clear the conversation; restore readiness without resuming anything.

**Blocked by:** 04: Manual replacement and delivered-reply context.

**Status:** ready-for-agent

- [ ] Lock or mute independently inhibits microphone capture, stops playback, cancels recognition/generation/synthesis, and closes the conversation.
- [ ] Temporary audio, pre-roll, context, and any current-session answer access are cleared on inhibition; no late canceled result restores them.
- [ ] Activation and ambient processing cannot bypass an active inhibition, including while acknowledgment or cleanup is in progress.
- [ ] Unlocking or unmuting restores activation readiness only when every inhibition has cleared; old work and context never resume.
- [ ] Hardware-mute signals are represented at the public desktop/audio boundary and respected; actual KDE/device signal integration is validated in the desktop ticket.
- [ ] Public-interface tests apply both inhibitions in different orders and during each active state, including simultaneous inhibition and stale playback/inference events.
- [ ] Document mute controls, locked/muted versus idle behavior, independent inhibition precedence, and the distinction between simulated signals and real desktop verification.
