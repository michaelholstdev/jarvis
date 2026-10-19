# 18: Offline and desktop stability acceptance

**What to build:** Verify prolonged private conversation and idle operation survive ordinary desktop failures and work with external connectivity disconnected.

**Blocked by:** 05: Conversation expiry and explicit extension; 11: Concise speech and temporary text answers; 12: Login startup, KDE activation, and device recovery — M3; 15: Real playback delivery in follow-up context.

**Status:** ready-for-human

Claimed by Codex for implementation and acceptance evidence, 2026-10-19.

- [ ] Run a two-hour idle soak showing bounded CPU/RAM, queues, buffers, and log growth with no ambient STT/LLM invocation or retained conversation content.
- [ ] Complete a 30-turn follow-up conversation and extended sessions with explicit renewal, verifying noise deadlines, context continuity, expiry, and cleanup.
- [ ] Exercise systemd/service restart, microphone/backend disconnect/reconnect, suspend/resume, and stalled operations; recovered services never replay canceled questions or replies.
- [ ] With real devices, verify lock/mute immediately stops capture/playback, independent inhibitions remain effective, and readiness restoration cannot resume prior work.
- [ ] Using preinstalled local models, repeat representative activation/question/follow-up/text/closure flows with external connectivity disconnected; loopback services remain available and no cloud/tool request occurs.
- [ ] Run cancellation/interruption scenarios and confirm delivery-context limits and clearing of temporary text/audio access; this suite does not claim acoustic spoken-stop acceptance in place of its separate ticket.
- [x] Document setup, exact test procedures/commands, durations, environment, reproducible results, and every failure or unavailable scenario as failed/unvalidated rather than implying success.


## Answer

Acceptance tooling and synthetic evidence delivered; **physical and full soak
acceptance remain open**. See [the report](../../../docs/stability-acceptance.md)
and [map](../map.md).

- Added a configurable idle collector (two hours by default) with content-free
  resource/log observations and explicit unvalidated queue/buffer/device gates.
  The user requested stopping the corrected run; its last buffered checkpoint
  reports 44.02 minutes, RSS below the start and zero idle log bytes. It is
  explicitly incomplete, not a two-hour or final CPU pass.
- Added an isolated loopback-only offline runner using preinstalled models and
  private silent sinks. Initial + 30 actual synthetic Whisper/Ollama/Piper turns
  complete; separate extension/text/privacy/recovery/delivery/desktop and 30-turn
  contextual socket suites pass. Human German usefulness remains unvalidated
  (only 12/30 replies match the required-word screen).
- Added a 30-turn socket context/closure regression and command regressions for
  stale passing reports after failed reruns. Review found/fixed CPU undercount
  after worker exit and stale evidence. Both review axes have zero remaining
  implementation findings.
- `npm run check` and full `npm test` pass: **204 Node / 38 Python tests**.
- Real headset/speaker lock/mute, actual device/backend hotplug, installed systemd
  restart and suspend/resume remain unvalidated, with exact manual procedures.
  Internal queue/buffer occupancy and external-request-attempt auditing remain
  unvalidated. #14 acoustic spoken-stop acceptance is not claimed here.

Original mixed hardware acceptance checkboxes remain open where the available
evidence covers only software/synthetic behavior.
