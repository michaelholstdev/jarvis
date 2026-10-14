# 18: Offline and desktop stability acceptance

**What to build:** Verify prolonged private conversation and idle operation survive ordinary desktop failures and work with external connectivity disconnected.

**Blocked by:** 05: Conversation expiry and explicit extension; 11: Concise speech and temporary text answers; 12: Login startup, KDE activation, and device recovery — M3; 15: Real playback delivery in follow-up context.

**Status:** ready-for-agent

- [ ] Run a two-hour idle soak showing bounded CPU/RAM, queues, buffers, and log growth with no ambient STT/LLM invocation or retained conversation content.
- [ ] Complete a 30-turn follow-up conversation and extended sessions with explicit renewal, verifying noise deadlines, context continuity, expiry, and cleanup.
- [ ] Exercise systemd/service restart, microphone/backend disconnect/reconnect, suspend/resume, and stalled operations; recovered services never replay canceled questions or replies.
- [ ] With real devices, verify lock/mute immediately stops capture/playback, independent inhibitions remain effective, and readiness restoration cannot resume prior work.
- [ ] Using preinstalled local models, repeat representative activation/question/follow-up/text/closure flows with external connectivity disconnected; loopback services remain available and no cloud/tool request occurs.
- [ ] Run cancellation/interruption scenarios and confirm delivery-context limits and clearing of temporary text/audio access; this suite does not claim acoustic spoken-stop acceptance in place of its separate ticket.
- [ ] Document setup, exact test procedures/commands, durations, environment, reproducible results, and every failure or unavailable scenario as failed/unvalidated rather than implying success.
