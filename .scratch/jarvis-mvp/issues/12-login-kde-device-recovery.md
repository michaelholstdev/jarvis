# 12: Login startup, KDE activation, and device recovery — M3

**What to build:** Use Jarvis after login through a global KDE shortcut, with real lock/mute privacy enforcement and graceful desktop audio recovery.

**Blocked by:** 07: Failures, explicit retry, and capability recovery; 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [ ] Two systemd user services start after session audio is available, run without root, expose readiness, and use on-failure restart with sensible limits; linger stays disabled by default.
- [ ] A configured KDE shortcut triggers single-press manual activation through the supported CLI/local interface without requiring a tray or application window.
- [ ] Real desktop lock/unlock and hardware/software mute signals enforce existing capture inhibition, cancellation, cleanup, and independent lock/mute precedence.
- [ ] Microphone disconnect/reconnect, audio backend interruption, device change, and suspend/resume recover or report degraded capabilities without busy loops, unexpected capture, or replay of old work.
- [ ] Local sockets/configuration/state use standard XDG locations with restrictive user permissions; no public listener is introduced.
- [ ] Target-desktop acceptance verifies startup, shortcut acknowledgment timing, no idle transcription, no locked/muted capture, independent inhibition clearing, and no canceled-work resumption.
- [ ] Document exact user-service installation/enable/start/stop/status/log commands, KDE shortcut setup, device configuration, suspend/reconnect troubleshooting, update and uninstall procedures, and manual-only readiness; describe any system package steps separately from user services.
