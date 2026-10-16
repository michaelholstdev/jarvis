# Ticket #12: desktop acceptance evidence

Automated software coverage uses substituted desktop commands and real
core/Python Unix sockets. It proves protocol/control behavior, not physical
capture cessation or a KDE login. Target CachyOS / Plasma hardware acceptance
is **unvalidated**; M3 is not claimed passed by these fixtures.

| Check | Software evidence | Target headset | Target speakers |
| --- | --- | --- | --- |
| Private XDG setup, stale socket recovery, live peer protection | `service-startup.test.ts` | unvalidated | unvalidated |
| Initial unknown state inhibits activation | `desktop.test.ts`, `desktop-runtime.test.ts` | unvalidated | unvalidated |
| Lock/source mute/CLI mute remain independent | same | unvalidated | unvalidated |
| Suspend, device replacement and monitor loss close work; recovery does not replay | same | unvalidated | unvalidated |
| No idle recognition / late canceled results | existing privacy, microphone and recovery suites | unvalidated | unvalidated |
| Login services start after audio without a window | unit definitions and bounded startup handshake | unvalidated | unvalidated |
| KDE single-press cue timing and capture after cue | existing turn-driver ordering tests | unvalidated | unvalidated |
| No physical capture while locked/muted; physical switch exposed to PipeWire | requires actual devices | unvalidated | unvalidated |

Run after installing the [user services](../systemd/README.md). Record date,
CachyOS/Plasma/PipeWire versions, selected source/sink names, headset or speakers,
model manifest revisions, and health before/after each scenario. Keep consented
measurements separate from routine logs; do not record private utterances.

1. Log out and log in with no terminal/tray open. Inspect both service statuses,
   health, user ownership, `Linger=no`, private directory/socket/config modes,
   and journal for startup errors. Confirm manual-ready, voice-ready, wake
   unavailable. A mock configuration cannot pass voice readiness.
2. Leave idle for at least five minutes. Inspect PipeWire's capture streams with
   `pw-top`/`pactl list source-outputs` and operation diagnostics: no Jarvis capture,
   recognition or generation at idle. Models resident in RAM are permitted.
3. Press the KDE shortcut once. Measure key-to-audible-cue and cue-end-to-capture
   start using a timestamped screen/audio observation. Confirm listening starts
   after the cue and speech is not clipped; report actual timing, never an assumed
   latency. Ask a German question, then a contextual follow-up. End the conversation.
4. During listening, thinking, synthesis and playback, lock the desktop. Verify
   microphone and playback cease, in-flight inference is canceled, text access
   clears, and no old content returns after unlock. Measure physical stop delay.
5. Repeat using software source mute and the physical headset switch. Confirm
   `pactl --format=json list sources` reports `mute:true` for each switch. If the
   hardware switch does not publish mute, record **failed/unsupported** for that
   device; silent samples alone cannot establish mute detection.
6. Combine lock, source mute and CLI mute. Unlock while source mute remains;
   unmute the source while CLI mute remains. Each remaining inhibition must keep
   capture unavailable. Clear all: readiness returns, conversation stays idle.
7. Unplug the selected microphone/output during idle and during each active stage.
   Reconnect it; confirm degraded/inhibited health while absent, bounded recovery,
   no alternate-device capture, and no resumption until a new shortcut press.
   Repeat with PipeWire interruption/restart in a disposable test session.
8. Suspend/resume during idle and each active stage. Check cancellation/cleanup,
   private buffers/text cleared, readiness restored only with valid lock/mute
   state, and no canceled work replay. Repeat a core/audio crash and inspect the
   bounded service restart and stale-socket handling.
9. Stop both services and verify no worker or capture remains. Restart; repeat
   the locked/muted startup case. Check journal content contains no test question,
   prompt or answer. Record every scenario as passed, failed or unvalidated.

Hardware testing is intentionally manual: the automation does not lock the user's
screen, change mute, disconnect devices, restart their PipeWire or suspend the
computer. Spoken stop and hands-free wake accuracy have separate gates; this
manual-only deployment does not claim them.

Integration sources: KDE's [screen-locker D-Bus contract](https://github.com/KDE/kscreenlocker/blob/master/dbus/org.freedesktop.ScreenSaver.xml)
and [implementation](https://github.com/KDE/kscreenlocker/blob/master/interface.cpp),
and systemd's [logind API](https://github.com/systemd/systemd/blob/main/man/org.freedesktop.login1.xml).
