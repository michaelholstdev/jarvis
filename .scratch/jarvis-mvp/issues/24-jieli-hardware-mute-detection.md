# 24: Jieli hardware mute is not exposed to Jarvis through PipeWire mute

**Type:** Bug

**Status:** needs-triage

**Blocked by:** Determine whether the device exposes a usable hardware-mute signal.

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
