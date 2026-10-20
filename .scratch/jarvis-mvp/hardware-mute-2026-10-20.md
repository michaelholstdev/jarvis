# #24: Jieli physical-mute interface investigation — 2026-10-20

Candidate: `d3e119d21aab1b1418569f6226f72480f50c0c88` (documentation-only
investigation; runtime unchanged). CachyOS kernel `7.2.11-1-cachyos`,
PipeWire `1.6.9` through PulseAudio compatibility.

## Device and method

User reconnected the actual microphone, then explicitly confirmed each held
physical-switch position. USB identity: `3654:4455`, revision `1.00`, serial
`4150345930323108`, Jieli Technology USB Composite Device. Selected source:
`alsa_input.usb-Jieli_Technology_USB_Composite_Device_4150345930323108-00.pro-input-0`.
At inspection it was ALSA card 3, USB `1-3`; these numeric/path assignments are
session-specific, not configuration IDs.

Read-only inspection used `lsusb -v -d 3654:4455`, `lsusb -t`,
`amixer -c 3 contents`, `/proc/asound/card3/usbmixer`,
`/proc/asound/card3/stream0`, `/sys/bus/hid/devices`, and
`pactl get-source-mute` for the exact configured source. No recording, speech
recognition, inference or playback was started. Both snapshots show capture
`Status: Stop`. No source mute, ALSA control, device profile or permissions were
changed. The user left the physical switch unmuted at the end.

## Observed interfaces

- [USB descriptors](hardware-mute-2026-10-20/usb-descriptors.txt): one
  configuration, two audio interfaces (control and streaming), both bound to
  `snd-usb-audio`. No HID or vendor-specific interface and no interrupt endpoint.
  The only streaming endpoint is isochronous PCM input `0x83`.
  `lsusb` warns that it cannot open the USB device; the cached configuration
  descriptors were available (trailing whitespace stripped in the saved output).
  No privileged raw USB control queries were made.
- Feature unit 5 advertises standard mute and volume controls.
  [ALSA mixer mapping](hardware-mute-2026-10-20/usb-mixer.txt) exposes these as
  `Mic Capture Switch` (inverse boolean) and `Mic Capture Volume`.
  The remaining control is the mono capture channel map. No separate physical
  switch indicator is listed.
- No Jieli device appears in the HID inventory in either snapshot. Sysfs lists
  only audio interfaces, with a sound child under the control interface; no
  device input-event child was present ([sysfs inventory](hardware-mute-2026-10-20/sysfs-interfaces.txt)). There is no exposed Jieli HID report
  descriptor or evdev switch to monitor in this configuration.

| User-confirmed position | UTC snapshot | ALSA Mic Capture Switch | ALSA volume | PipeWire mute |
| --- | --- | --- | --- | --- |
| Muted and held | 06:01:05 | `on` (capture enabled) | 147 | `no` |
| Unmuted and held | 06:01:33 | `on` (capture enabled) | 147 | `no` |

Raw command results: [muted](hardware-mute-2026-10-20/muted.json),
[unmuted](hardware-mute-2026-10-20/unmuted.json). ALSA values are driver-visible
control values; this does not prove the firmware has no private register or
that an uncached USB request would return the same value. No vendor protocol
for such a register was identified. Electrical sample silencing was not tested
and cannot establish cancellation/cleanup even if it works.

## Support verdict and release handling

**Unsupported physical-switch detection for this device/configuration.** The
available standard control path does not distinguish the confirmed positions,
and there is no exposed HID/event path. Do not add a poller of the unchanged
ALSA control or infer state from silent samples. Reconsider only with a
documented, readable state signal and actual switch evidence.

Retain Jieli as a development setup only; do not accept it for a release claiming
hardware-switch privacy. No runtime/configuration or replacement device change
is made. The selected release setup remains unaccepted until a supported signal
is integrated and validated, or another setup passes physical-switch acceptance.
This is a release-gating decision, not a waiver of PRD FR-19 or hardware mute.

#12's hardware-switch criterion remains **failed/unsupported** for Jieli;
software source mute is separately supported. If a supported detector is later
added, repeat physical mute/unmute during capture, inference, synthesis and
playback, measure bounded cancellation/cleanup, combine lock/source/CLI mute,
and verify readiness without any canceled-work resumption. None of those active
physical-switch trials is claimed here.

## Interface references

The [ALSA control interface](https://www.alsa-project.org/alsa-doc/alsa-lib/control.html)
documents control values and change notification; it does not guarantee that a
physical switch updates a control. Linux's
[HID introduction](https://docs.kernel.org/hid/hidintro.html) explains descriptor
inspection, and the [hidraw API](https://docs.kernel.org/hid/hidraw.html) exposes
raw reports for devices with such an interface. These describe candidate
interfaces, not Jieli-specific support. Inspected 2026-10-20.

Map: [MVP implementation map](map.md).
