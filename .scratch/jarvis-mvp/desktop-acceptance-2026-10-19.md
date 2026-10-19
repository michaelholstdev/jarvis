# #12: Headset desktop acceptance — 2026-10-19

Candidate: `4b76547ecf494efeaa58cfb5873e641f20f0b501`.
Session: KDE Plasma 6.8.0 / Wayland, CachyOS kernel `7.2.11-1-cachyos`,
PipeWire 1.6.9, Ollama 0.40.6, Node 24.11.1.

## Setup

- User-confirmed headphones on analog line-out:
  `alsa_output.pci-0000_2f_00.4.analog-stereo`.
- User-confirmed Jieli USB microphone:
  `alsa_input.usb-Jieli_Technology_USB_Composite_Device_4150345930323108-00.pro-input-0`.
- Manifest-verified Parakeet TDT v3 INT8 and Piper Thorsten medium;
  local `llama3:latest`. Final #17 model selection remains open.
- Config SHA-256: `5bad0c1fd67d6c76c713d041604433f7d371ab2f8ae120eb02e32e0005e419e6`.
- Both user units installed/enabled and active, initially zero restarts;
  linger disabled. Actual re-login startup verified below.
- Local core unit override uses
  `/home/michael/.local/share/nvm/v24.11.1/bin/node`, because `/usr/bin/node`
  is absent. Checkout symlink: `~/.local/share/jarvis`.
- Config/state/runtime directories observed as 0700, config and sockets as 0600.
- Voice/STT/TTS/inference capabilities ready; wake unavailable. Top-level health
  `mode: mock` is a pre-existing hardcoded label; loaded audio config and audio
  startup report real `voice` mode.

## Observations

- Initial shortcut/basic conversation: user reported that it basically works,
  with pronunciation sometimes unclear. Speech quality belongs to #17.
  No quantitative shortcut/cue/capture timing was measured.
- Software-mute trial during playback: user confirmed audible playback stopped
  and did not resume after unmuting. Journal at 11:58:41 UTC confirms privacy
  cancellation during playback; subsequent CLI text check found no text answer.
  However, roughly 1.2-second serial polling saw `Mute: no` for the selected
  microphone throughout. The exact mute control and trigger are not established;
  do not mark source-mute acceptance passed until a held mute is observed.
- At the post-trial check Jarvis was idle and ready, with no source-output streams.
  KDE settings briefly created its own capture streams during the trial; those
  must not be attributed to Jarvis.
- Held source mute verified around 12:02 UTC: selected Jieli source reports
  `Mute: yes`, health reports `hardware_muted: true`, manual/voice activation
  unavailable and state idle. CLI activation exits 1 with `unavailable`; a
  subsequent check confirms no capture streams and no text answer. This passes
  idle source-mute enforcement; source-mute interruption in each active phase
  and physical stop latency remain open. Health also retains a TTS `unavailable`
  last-failure entry despite currently ready capabilities; cause not diagnosed.
- Independent CLI/source mute verified: with both set, clearing the source mute
  leaves `muted: true`, `hardware_muted: false`, idle and activation unavailable.
  A CLI activation attempt is rejected with `unavailable`; no capture streams.
  Clearing CLI mute then restores manual/voice readiness with all inhibitions
  false, state idle and no capture streams; no canceled work resumes.
- Physical hardware mute: after clarifying switch direction, the user explicitly
  confirmed hardware mute activated. At 12:06:12 UTC the configured Jieli source
  still reports `Mute: no`; Jarvis reports `hardware_muted: false` and activation
  ready. No capture was active. **Hardware-mute detection unsupported for this
  setup through the current PulseAudio mute integration.** This does not establish
  whether the switch electrically silences samples; it cannot establish hardware
  mute cancellation/cleanup. Hardware-mute acceptance remains failed/unsupported,
  not passed. Software source mute was independently observed and enforced.
- Lock during playback: poll at 12:08:46 UTC reports speaking; 12:08:48 reports
  locked, idle, activation unavailable, no capture streams. Journal shows privacy
  cancellation at 12:08:48, with audio interruption about 59 ms after the first
  core privacy operation (software timestamps, not physical acoustic latency).
  Unlock at 12:09:00 restores idle readiness without capture or resumption;
  subsequent CLI text access returns no answer. User confirms silence and no
  restart after unlock. Exact audible cessation at lock and physical delay were
  not explicitly reported/measured. No claim of coverage for other active phases.
- Second lock trial: user reports Jarvis stayed silent. Polls show follow-up
  capture/listening at 12:10:47–48 UTC, then thinking with no stream at 12:10:52,
  followed by locked/idle at 12:10:53. Unlock at 12:10:59 restores idle readiness,
  with no capture, no text answer and no resumed response. Journal resolves the
  phase more precisely: synthesis began at monotonic 20530387 ms and privacy
  cancellation at 20530604 ms, before playback. This covers lock during synthesis,
  not inference or lock while physical capture was still active.
- Third lock trial: journal shows recognition started at 12:12:04 UTC, speech
  detection at 12:12:06, privacy cancellation at 12:12:08, and audio interruption
  about 44 ms after the first core privacy operation. There is no intervening
  endpoint/final transcript or inference start. User confirms the requested
  lock/unlock trial completed. Post-unlock checks show idle readiness, no capture
  streams and no text answer. The 15-minute polling collector expired before this
  lock, so during-lock stream absence and physical cessation latency were not
  directly sampled. Software recognition cancellation during capture is verified.
- Real lock/source-mute precedence: at 12:13:48 UTC both `locked: true` and
  `hardware_muted: true`, Jieli source muted, idle and no capture streams. At
  12:13:59 unlock clears only `locked`; source mute remains true and activation
  unavailable. Subsequent CLI activation exits 1 with `unavailable`, no streams.
  This verifies real unlock cannot clear source mute; CLI/source mute independence
  was separately checked above.
- Idle microphone unplug: at 12:15:07 UTC selected Jieli source absent while
  Brio and analog sources remain available. Jarvis is idle, activation unavailable,
  with fail-closed `locked`/`hardware_muted` inhibitions (these also represent
  unknown desktop/device state, not a claim that the desktop was physically
  locked). No capture streams; CLI activation rejected. Both services remain
  active with zero restarts. No fallback capture on remaining microphones observed.
- Idle reconnect: at 12:15:54 UTC Jieli returns under the same configured name,
  new source index 12974 (previously 4394). All inhibitions clear, manual/voice
  readiness restored, state idle and no capture streams. Both services still
  active with zero restarts. No new activation was requested and no work resumed.
- Microphone unplug during capture: journal shows cue completion and recognition
  start at 12:16:38 UTC, then privacy cancellation at 12:16:41 and audio interruption
  about 64 ms after the first core privacy operation (software response timing,
  not physical cessation latency). At 12:16:52 idle, fail-closed inhibitions,
  activation unavailable, no capture streams; both services active, zero restarts.
- Reconnect after capture interruption: poll at 12:17:20 UTC shows same Jieli name
  with index 13424, idle readiness and no capture. A deliberate shortcut starts the
  next turn at 12:17:34; no automatic replay preceded that activation.
- Microphone unplug during playback: playback starts at 12:17:48 UTC; privacy
  cancellation follows at 12:17:52, with audio interruption about 62 ms after the
  first core privacy operation. User confirms the audible answer stopped. Polls
  show source absent, idle, activation inhibited and no capture at 12:17:53;
  post-trial CLI text access is empty. Physical unplug-to-silence delay unmeasured.
- Core crash injection executed once at 12:19:53 UTC during playback. Systemd
  records SIGKILL, then restart counter 1 at 12:20:08; new core starts and passes
  readiness at 12:20:09. A separate deliberate activation begins at 12:20:38.
  No resumed old turn is logged before it. Audible stop/non-resumption was not
  separately confirmed by the user; this is systemd/control evidence only.
- User then reported cue without successful processing. Recognition and inference
  complete in the journal, followed by repeated synthesis failures. A matching
  synthetic duration-overflow reproduction is documented in [#23](issues/23-long-speech-duration-overflow.md).
  Do not count failed voice trials as acceptance passes. No crash injector remains
  armed; no runtime/config workaround was applied.
- Short-answer control after diagnosis: user confirms a short question works.
  Journal around 12:25 UTC shows successful recognition, inference, synthesis and
  fully drained short playback; subsequent follow-up capture is active as expected
  during the open conversation. This is not an idle-privacy measurement. Long
  speech overflow remains unresolved in #23.
- Software source mute during capture: recognition starts 12:26:52 UTC; privacy
  cancellation at 12:26:57, without endpoint/final transcript or inference in
  between. Audio interruption follows first privacy operation by about 54 ms
  (software timestamps). At 12:27:09 selected source is muted, state idle,
  activation inhibited, no capture streams and no text answer. Physical capture
  cessation latency was not acoustically measured.
- Software source mute during playback: playback starts at 12:28:21 UTC;
  privacy cancellation at 12:28:24, with audio interruption about 53 ms after
  first core privacy operation. User confirms audible answer stopped. At 12:28:39
  selected Jieli source explicitly reports muted; Jarvis idle/inhibited, no
  capture streams and empty text access. Physical mute-to-silence delay unmeasured.
- Stop/restart while source muted: both units stopped successfully; systemd
  reports inactive, MainPID 0 and no cgroup. `/proc` check finds no Jarvis
  core/audio/output-worker process and PipeWire reports no capture streams.
  Source remains muted. Starting both units succeeds; at 12:29:19 UTC both are
  running, core idle with `hardware_muted: true`, activation unavailable, no
  capture and no failure. This verifies muted startup and clean service stop;
  it is not a KDE re-login or crash test of the audio unit.
- Real suspend during capture: recognition starts 12:32:28 UTC; privacy
  cancellation and audio interruption occur at 12:32:32. System suspend journal
  independently confirms suspend at 12:32:32 and resume at 12:32:49. Unlock
  cleanup completes around 12:32:56; user reports silence throughout the return.
  At 12:33:29 both units running with zero restarts, all inhibitions clear,
  manual/voice ready, idle, no capture streams and empty text access. No new
  recognition/inference/playback occurs after resume without activation.
  Physical stop latency and other suspend phases remain unmeasured/unvalidated.
- Real suspend during playback: playback starts 12:34:24 UTC; privacy
  cancellation at 12:34:26, audio interruption about 52 ms after first privacy
  operation. System journal confirms suspend 12:34:26, resume 12:34:54. User
  confirms silence after return. At 12:35:24 core idle/ready, all inhibitions
  clear, no capture and no text; both services running, zero restarts. No old
  playback resumes. This is one playback-phase trial, not all suspend phases.
- KDE shortcut setup initially failed: desktop file `net.local.node.desktop`
  had the correct absolute Node path, but invoking its registered `_launch`
  reproduced KWin's executable-not-found error with a path lacking the leading
  slash. A sycoca rebuild alone did not resolve it. Backed up the user's entry
  and shortcut configuration under `/tmp/jarvis-shortcut-backup-hjgedh1k`, added
  the existing `Meta+J` binding as `X-KDE-Shortcuts`, removed only this component's
  stale registration and re-registered the same action/key through KDE D-Bus.
  The identical `_launch` probe then reached listening successfully. The probe
  was cleaned up with CLI mute/unmute; Jarvis returned idle/ready. Physical
  Meta+J and persistence through a real KDE re-login were subsequently confirmed
  by the user in the following trial.
- Real logout/login: old user manager stops core/audio at 12:49:48 UTC; the new
  user manager starts audio at 12:50:07 (ready at 12:50:13), then core (ready at
  12:50:14). User confirms Meta+J and a spoken short answer without manually
  starting either service. Journal verifies recognition, synthesis and complete
  playback at 12:50:32. At 12:51:40 both services running, zero restarts,
  linger disabled, core idle/ready and no capture streams. Login startup and
  shortcut persistence pass for this existing account with the local Node override;
  this is not #19's fresh-account installation test.
- Audio-service crash trial: one-shot SIGKILL of audio main at 12:59:13 UTC
  during playback. User confirms speech stopped at four. Systemd schedules
  restart at 12:59:28 and audio becomes ready at 12:59:32. **Failed acceptance:**
  core automatically starts recognition twice with the same ID, receives `busy`,
  emits a failure cue and opens follow-up capture without another activation.
  A real configured-microphone `pw-record` stream is observed at 12:59:50.
  Explicit CLI mute/unmute then closes the conversation; no capture remains.
  Tracked as [#25](issues/25-audio-restart-resumes-capture.md); readiness restoration
  alone is not a pass. No further crash injector remains armed.
- Corrected core `f5fd4f8` deployed at about 13:11:37 UTC after 206 Node/42 Python
  tests and clean Standards/Spec re-review. The prepared post-fix crash observer
  expired at 13:15:06 without execution. User's later attempts at 15:04 UTC
  therefore do not constitute a crash rerun: first recognition ends without
  inference (cause unknown without retained transcript); second attempt reaches
  playback, then the user manually stops it through a privacy transition.
  Audio PID/restart counter are unchanged. Core is idle/ready with no capture
  afterward. Post-fix restart acceptance remains open. Observer cancellation
  marker has been set; no further automatic crash test is armed.
- Actual corrected audio-crash rerun: user triggers SIGKILL during playback at
  15:12:39 UTC. Systemd schedules restart at 15:12:54; audio becomes ready at
  15:12:58. Cleanup finishes without automatic recognition; existing follow-up
  time expires at 15:12:59, followed only by the normal configured end cue.
  User confirms no resumed speech. At 15:13:25 core idle/ready, no capture streams,
  no pending cleanup and both services running. **Pass for this actual
  playback/audio-crash case on `f5fd4f8`.** #25 is resolved; other untested crash
  phases and precise physical cessation latency are not implied passed.
- Full desktop audio-backend interruption during playback on `f5fd4f8`: user stops
  PipeWire/PulseAudio services and sockets plus WirePlumber at 15:16:43 UTC,
  after playback starts at 15:16:42, then restarts them at 15:16:48. Lifecycle
  journal confirms all three services stopped and started. Core requests privacy
  cleanup immediately on backend loss; audio interruption follows about 49 ms
  after the first privacy operation (software timing). A generic audio-runtime
  diagnostic at backend loss is retained, not a second long-speech diagnosis.
  Readiness/desktop reconciliation settles by 15:16:52. User confirms silence.
  At 15:17:19 all five audio units and both Jarvis units active, core idle/ready,
  no capture streams and no resumed operations. This passes this actual playback
  outage/recovery case in the user's current acceptance session; other phases and
  a separate disposable session were not exercised by this trial.
- Five-minute idle after login: [record](desktop-acceptance-2026-10-19-idle.json)
  spans 300.38 seconds with 252 serial samples. All report uninhibited ready/idle,
  with zero `pw-record` streams targeting the configured microphone. The
  corresponding core/audio journal has no recognition, inference or service-start
  event. Pass for sampled manual-only idle/privacy scope; no continuous physical
  sample, CPU/RAM, heap-erasure or queue/buffer occupancy claim.

- Output-disconnect trial after the headphone-unplug instruction: playback starts
  at 15:20:13 UTC and privacy cancellation occurs at 15:20:20, with audio
  interruptions immediately afterward. No later recognition or playback appears
  through the 15:22:47 reconciliation. At the subsequent check core is idle/ready,
  cleanup complete and no capture streams exist. The selected analog sink has
  changed index from 79 to 655 while retaining its stable name; line-out still
  reports available. This establishes a detected output identity transition and
  cancellation, not reliable physical jack-availability detection. User confirms
  silence after reconnect. Subsequent health is idle/ready with cleanup complete,
  no capture streams and no recognition/playback events after reconciliation.
  Disconnect/reconnect cancellation and no automatic resumption pass for this
  observed output transition. User subsequently confirms that fresh explicit
  activation and a short spoken question work again after reconnect.

- Locked-startup trial: following the user's delayed restart command, both units
  stop at 15:29:25 UTC; audio starts at 15:29:28 and core at 15:29:29. Core performs
  privacy cleanup only; no recognition or playback follows. User confirms silence.
  The subsequent live check is unlocked, idle/ready, both units running with zero
  restarts and no capture streams. Asked whether the terminal health snapshot
  showed `inhibitions.locked:true`, user responds "passt", treated as confirmation.
  Pass for this user-confirmed locked startup and silent unlock; the terminal
  snapshot itself was not retained as an independent structured observation.

- Lock during inference on `f5fd4f8`: recognition completes and inference begins
  at 15:33:39 UTC, first token at 15:33:40, privacy cancellation at 15:33:44.
  No synthesis or answer playback is dispatched. After unlock/reconciliation
  at 15:33:51, subsequent health is idle/ready with no pending cleanup, no retry
  and no capture streams. User reports the requested lock/unlock procedure done.
  Pass for inference cancellation and observed absence of resumed operations;
  no physical cessation latency measurement is implied.

- Source mute during synthesis on `f5fd4f8`: at 15:34:48 UTC inference starts;
  synthesis starts at 15:34:55 and emits first audio at 15:34:56. Privacy
  cancellation follows during synthesis before any answer-play operation.
  Selected Jieli source is independently confirmed `Mute: yes`; core reports
  source inhibition (`hardware_muted:true`), idle state, activation unavailable,
  cleanup complete and no capture streams. This covers source mute during
  synthesis, not the intended inference phase.

- Source mute at inference entry on `f5fd4f8`: at 15:35:55 UTC recognition
  completes, inference operation 35 is dispatched and privacy cancellation follows
  about 2.6 ms later, before any first-token/synthesis event. Jieli reports
  `Mute: yes`; health is inhibited/idle, activation unavailable, cleanup complete
  and no capture streams. CLI text reports no answer. Pass for cancellation at
  the inference-entry boundary; sustained generation under source mute was not
  separately sampled. User subsequently confirms silence after unmute. At the
  post-unmute check the selected source reports `Mute: no`, health is idle/ready,
  no inhibitions or pending cleanup remain, and there are no capture streams.
  Journal shows reconciliation only, with no new recognition or playback.
  Unmute restores readiness without automatically resuming canceled work.

- Core-crash playback rerun on `f5fd4f8`: answer playback starts at 15:37:43 UTC,
  user SIGKILLs core at 15:37:45 and confirms the answer stopped and stayed off.
  Systemd restarts core at 15:38:00; ready at 15:38:01. Audio main survives.
  After restart only privacy cleanup is dispatched; no recognition or playback.
  Post-trial health is idle/ready with no pending cleanup, no capture streams and
  no available answer text. Core restart count is one, audio zero since the last
  deliberate joint restart. Pass for this actual playback/core-crash case and
  user-confirmed audible cessation/no replay; exact physical stop delay remains
  unmeasured. User subsequently confirms a fresh shortcut activation and short
  question work again. Journal confirms activation at 15:38:51 UTC, recognition,
  inference, synthesis and complete playback at 15:38:59. The following capture
  is the expected follow-up of this explicitly activated new conversation, not
  an automatic restart of the canceled conversation.

Durable content-free observations:
[polling snapshots](desktop-acceptance-2026-10-19-observations.jsonl) and
[filtered service events](desktop-acceptance-2026-10-19-events.jsonl),
[service/suspend lifecycle](desktop-acceptance-2026-10-19-system-events.jsonl),
[setup/model identity](desktop-acceptance-2026-10-19-setup.json) and the
[five-minute idle record](desktop-acceptance-2026-10-19-idle.json).
Polling covers 11:57–12:12 and 12:13–12:28 UTC, with gaps noted above;
later trials use the service/system journals and post-trial checks.
Polling cannot establish physical stop latency or continuous absence of capture.

## Coverage and remaining work

The individual observations above are setup-specific. Remaining coverage:

- Five-minute uninhibited idle observation passed above. This remains separate
  from the waived two-hour #18 duration and does not establish resource bounds.
- Hardware mute detection is unsupported for this microphone; see [#24](issues/24-jieli-hardware-mute-detection.md).
- Long answers fail synthesis; [#23](issues/23-long-speech-duration-overflow.md)
  requires a bounded speech policy/fix and affected-trial rerun.
- Audio-service recovery initially resumed capture. [#25](issues/25-audio-restart-resumes-capture.md)
  is corrected, reviewed and the same actual playback/crash rerun passed above.
- Source mute at inference entry and during synthesis passed as recorded above.
  Physical device/suspend permutations beyond the phases recorded above remain
  unvalidated. Representative phase results do not pass untested permutations.
- Selected output disconnect/reconnect cancelled playback and remained silent;
  fresh explicit activation works again. Locked startup/silent unlock passed
  with user confirmation as recorded above.
  Actual backend outage/recovery passed for playback, not the other phases.
  Audio-unit playback/crash rerun passed
  after correcting the retained initial failure above.
  Core playback/crash rerun also passed with user-confirmed audible cessation;
  exact physical stop timing remains unmeasured.
- Shortcut key-to-cue, cue-end-to-physical-capture, and physical stop delays have
  no quantitative measurements. No late audio/text is observed in the sampled
  post-trial checks, but no direct heap/buffer-erasure measurement was performed.
- Final selected configuration still depends on #17. These results may be shared
  with #18/#19; they do not close any of those tickets or claim a release pass.
