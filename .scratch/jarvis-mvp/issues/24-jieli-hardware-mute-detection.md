# 24: Jieli hardware mute is not exposed to Jarvis through PipeWire mute

**Type:** Bug

**Status:** wontfix

**Resolution:** Investigated; physical-switch detection unsupported for the selected
device/configuration. No usable signal found in the inspected interfaces;
release hardware-mute gate remains open.

**Blocked by:** None for the unsupported-device outcome. Supported hardware-switch
acceptance remains with #12.

**Claimed by:** Codex — 2026-10-20; baseline `d3e119d`.

## Observed failure

During #12's 2026-10-19 actual headphone acceptance, the user explicitly confirmed
activating the microphone's physical mute switch. The configured Jieli USB source
continued to report `Mute: no`; other microphone source mute properties were also
false. Jarvis therefore remained activation-ready with `hardware_muted: false`.
This is an unsupported hardware-mute detection path for the selected setup, not
a passed privacy test. No microphone recording was started during this check.

Selected stable source:
`alsa_input.usb-Jieli_Technology_USB_Composite_Device_4150345930323108-00.pro-input-0`.

Separately setting source mute through KDE correctly reported `Mute: yes` and
Jarvis enforced cancellation and capture inhibition. Thus the observed gap is
specific to the physical switch being absent from the currently monitored signal.
Whether the switch electrically silences samples was not measured.

## Required outcome

- Determine whether this hardware exposes its switch through a documented
  local interface (for example a device control/event). Do not infer switch
  state from silent samples and do not assume a usable signal exists.
- If accessible, integrate it without weakening independent lock/source/CLI
  mute ownership or bounded cancellation and recovery.
- Otherwise record the unsupported device/feature explicitly and decide whether
  the selected release setup changes. Do not mark #12's hardware-mute criterion
  passed solely because software mute works.
- Repeat actual switch checks during capture, inference and playback if a
  supported detection path is added, including no canceled-work resumption.

## Evidence

[Headset desktop session](../desktop-acceptance-2026-10-19.md), held-switch check
at 12:06:12 UTC on candidate `4b76547`.

Map: [MVP implementation map](../map.md).

## Answer

Completed the ticket's unsupported-device outcome. The actual reconnected
`3654:4455` device advertises only two USB audio interfaces, no HID/event
interface. ALSA exposes mute/volume controls, but both user-confirmed held
physical switch positions report `Mic Capture Switch: on` and PipeWire
`Mute: no`. No usable signal was found through these documented interfaces.
[Investigation and raw evidence](../hardware-mute-2026-10-20.md) record the
limits, including no raw USB queries and no inference from silent samples.

No speculative runtime detector is added. Jieli remains a development setup;
it is not accepted as the selected release setup for hardware-switch privacy.
A supported path or a replacement setup must pass #12 before that release gate
can close. Source/CLI mute remains an explicit privacy control and does not
pass the physical-switch criterion. Installation, protocol health semantics,
desktop acceptance and FR-19 release documentation now expose this limitation.

No new test seam or runtime behavior is introduced, so no TDD test was added.
Existing desktop unit/socket checks pass (5 tests); `npm run check` passes.
Full validation passed: all **208 Node + 43 Python tests**. The first default
parallel `npm test` run timed out in the existing Python-handshake test; that
file passed alone (4 tests), then the full suite passed with Node file concurrency
limited to 1 (`npm run build && node --test --test-concurrency=1 dist/tests/*.test.js`,
followed by `uv run --frozen python -m unittest discover -s tests -p '*_test.py'`).
No test/runtime changes were needed. Saved command outputs match across both
held positions, all snapshot commands exited 0, and local documentation link
targets and diff whitespace checks pass.

### Standards review

No findings. Ticket status/claim/answer/map follow tracker rules; documented
privacy gates and glossary vocabulary are preserved. No baseline code smells.

### Spec review

No findings. The unsupported-device outcome records the inspected interfaces,
limits and release setup decision. Conditional active-phase hardware trials
remain required only if a supported detector is later added.

Review totals: Standards 0; Spec 0. Both reviews compare against baseline
`d3e119d`; unrelated existing working-tree changes are excluded.

Map: [MVP implementation map](../map.md).
