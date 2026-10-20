# 12: Login startup, KDE activation, and device recovery — M3

**What to build:** Use Jarvis after login through a global KDE shortcut, with real lock/mute privacy enforcement and graceful desktop audio recovery.

**Blocked by:** None for desktop acceptance; use the configuration selected by #17 for final candidate evidence.

**Status:** ready-for-human

## Remaining work plan — 2026-10-19

**Type:** Acceptance

**Outcome:** A manual headset session starts at KDE login and remains private and
recoverable through ordinary desktop failures. Implementation is delivered;
remaining work requires the actual desktop, so status is now ready-for-human.

Run one desktop acceptance session using [the procedure](../../../docs/desktop-acceptance.md):

- [ ] Verify login startup, single-press shortcut, device selection and health.
- [ ] Exercise lock, software mute and exposed hardware mute during capture,
  inference and playback; check independent inhibitions and actual cessation.
- [ ] Exercise unplug/replug, audio backend outage, service restart and
  suspend/resume; verify readiness recovery without replay or resumed capture.
- [ ] Check cleared text/context and late-event rejection; attach setup, candidate
  SHA, timings and verdicts. Link the same evidence from #18 and #19.

Physical privacy/recovery criteria in #18 are verified here once, rather than
repeated in a separate session. Speaker-specific results belong to #21.
Open focused bug tickets for failures and repeat affected checks after fixes.


**Claimed by:** Codex (implementation complete; target-desktop acceptance pending).

- [x] Two systemd user services start after session audio is available, run without root, expose readiness, and use on-failure restart with sensible limits; linger stays disabled by default.
- [x] A configured KDE shortcut triggers single-press manual activation through the supported CLI/local interface without requiring a tray or application window.
- [x] Real desktop lock/unlock and hardware/software mute signals enforce existing capture inhibition, cancellation, cleanup, and independent lock/mute precedence.
- [x] Microphone disconnect/reconnect, audio backend interruption, device change, and suspend/resume recover or report degraded capabilities without busy loops, unexpected capture, or replay of old work.
- [x] Local sockets/configuration/state use standard XDG locations with restrictive user permissions; no public listener is introduced.
- [ ] Target-desktop acceptance verifies startup, shortcut acknowledgment timing, no idle transcription, no locked/muted capture, independent inhibition clearing, and no canceled-work resumption.
- [x] Document exact user-service installation/enable/start/stop/status/log commands, KDE shortcut setup, device configuration, suspend/reconnect troubleshooting, update and uninstall procedures, and manual-only readiness; describe any system package steps separately from user services.

## Comments

2026-10-19: Installed both user units with a local Node path override and began
the actual user-confirmed headset desktop trials. Partial [session evidence](../desktop-acceptance-2026-10-19.md)
records real lock, source/CLI mute precedence, microphone unplug/replug,
stop/muted startup, core restart and suspend observations with explicit coverage
limits. Hardware mute is not exposed through the selected source's PipeWire mute
property. Repeated long-answer synthesis failures are tracked in [#23](23-long-speech-duration-overflow.md).
Login, remaining scenarios and precise physical timing remain open; no full
acceptance or closure claimed. This supersedes the historical statement below
that services have not been installed, without changing its earlier results.

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

Follow-up review findings resolved: failed snapshot commands now inhibit capture
immediately while holding the sampling gate until all sibling commands settle,
preventing overlapping command batches. Default/custom XDG installation and update
commands now use the same directory as creation and uninstall. Both regressions
were observed failing before their fixes and passing afterward. The reviewer
confirmed both original findings and the privacy-response regression resolved.
Documented install/update commands were also exercised in temporary default and
custom XDG homes. Final checks pass with **182 Node + 9 Python tests**; target KDE
and physical hardware acceptance remains open.
