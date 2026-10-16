# 12: Login startup, KDE activation, and device recovery — M3

**What to build:** Use Jarvis after login through a global KDE shortcut, with real lock/mute privacy enforcement and graceful desktop audio recovery.

**Blocked by:** 07: Failures, explicit retry, and capability recovery; 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

**Claimed by:** Codex (implementation complete; target-desktop acceptance pending).

- [x] Two systemd user services start after session audio is available, run without root, expose readiness, and use on-failure restart with sensible limits; linger stays disabled by default.
- [x] A configured KDE shortcut triggers single-press manual activation through the supported CLI/local interface without requiring a tray or application window.
- [x] Real desktop lock/unlock and hardware/software mute signals enforce existing capture inhibition, cancellation, cleanup, and independent lock/mute precedence.
- [x] Microphone disconnect/reconnect, audio backend interruption, device change, and suspend/resume recover or report degraded capabilities without busy loops, unexpected capture, or replay of old work.
- [x] Local sockets/configuration/state use standard XDG locations with restrictive user permissions; no public listener is introduced.
- [ ] Target-desktop acceptance verifies startup, shortcut acknowledgment timing, no idle transcription, no locked/muted capture, independent inhibition clearing, and no canceled-work resumption.
- [x] Document exact user-service installation/enable/start/stop/status/log commands, KDE shortcut setup, device configuration, suspend/reconnect troubleshooting, update and uninstall procedures, and manual-only readiness; describe any system package steps separately from user services.

## Comments

- Claimed for implementation; baseline `7db9f4b941d9c1fddcd76bf51eac58d86bf3849e` (recorded below before review). Confirmed test seams: desktop monitor → privacy/capability interface and CLI/service startup under temporary XDG directories. Target desktop acceptance remains an explicit hardware gate.

## Answer

Implementation is committed on the current branch. The two user units, KDE
single-press activation instructions, fail-closed real desktop monitor, independent
CLI/desktop inhibition ownership, device/backend/suspend cleanup, private XDG
startup preparation, bounded readiness checks and deployment lifecycle guide are
implemented. No services have been installed/enabled in the live user session.

Validation: `npm run check` passed; full `npm test` passed **181 Node + 9 Python**
tests. The service helper also passed standalone Ruff and strict mypy. Temporary
unit copies with executable paths resolved to this checkout passed
`systemd-analyze --user verify`; the literal deployment units require the documented
installation link and target `/usr/bin/node` before executable-path validation.

Target KDE login, physical headset/software mute, physical capture stop latency,
shortcut acknowledgment measurements and suspend/reconnect acceptance remain
**unvalidated**. This ticket's M3 acceptance gate stays open until the checklist in
[`docs/desktop-acceptance.md`](../../../docs/desktop-acceptance.md) has actual target
results. Do not infer hardware acceptance from substituted desktop fixtures.

Map: [MVP implementation map](../map.md).

Review: Standards found no actionable issues. Spec found two issues (graphical
target ordering and mute changes during an in-flight snapshot); both were fixed
and the reviewer confirmed no remaining actionable findings. The new regression
failed before the mute fix and passed afterward.
