# 19: Reproducible installation and release checklist — M4

**What to build:** Install the supported Jarvis setup on a fresh CachyOS user account and inspect an honest requirement-level release checklist with known restrictions.

**Blocked by:** 14: Spoken stop and acoustic acceptance; 16: German recognition comparison; 17: End-to-end latency and resource benchmarks; 18: Offline and desktop stability acceptance.

**Status:** ready-for-human

**Claimed by:** Codex — 2026-10-19; installation documentation and release evidence consolidation. Physical acceptance remains open.

- [x] Consolidate exact prerequisite, dependency, local-model/voice acquisition and verification, configuration, user-service installation, KDE shortcut, start/stop, health/log inspection, test, update, and uninstall instructions.
- [x] Separate necessary system package steps from unprivileged user-service operation; document disabled linger, standard XDG locations, permissions, and local-only endpoint settings.
- [ ] Validate the documented manual-activation setup on a fresh CachyOS user account with the target hardware/desktop, documenting any step that cannot yet be reproduced.
- [x] Map evidence to PRD FR-01 through FR-25 and M0–M4 gates, keeping P1 requirements deferred and marking each applicable requirement passed, failed, or unvalidated for its tested setup.
- [x] Local inference, idle privacy, bounded capture, and cancellation are mandatory release gates; failing them prevents a release claim even if other features work.
- [x] Manual activation can satisfy the MVP activation gate; unreliable spoken stop remains a disclosed FR-09 gap and a useful limited release must not claim every P0 requirement passed.
- [x] Include measured recognition, latency/resource, stability, and offline evidence, explicit model/licensing/provenance details, and any reviewed latency-target revisions.
- [x] Report headset and speaker support separately. Include optional wake results only if independently validated; ticket 13 is not a blocker and absent results are explicitly unvalidated/disabled.
- [ ] Before final release/hardware acceptance, revisit [#13](13-optional-validated-wake-activation.md) after stable manual voice operation: investigate model feasibility, then implement and validate wake if promising. Record either validated setup-specific results or concrete gaps and a linked follow-up; do not silently close #13 because its manual-only fallback was delivered. Successful wake validation remains optional for a manual-only release.
- [x] Document dialect/dictation/language-switching, device/acoustic, model, text-lifetime, and distribution limitations; no cloud fallback, tools, tray dependency, persistent memory, or general barge-in is implied.
- [x] Publishing release documentation does not turn unavailable hardware checks into passing results; retain unresolved evidence gaps and specify how to reproduce the remaining validation.


## Answer

Documentation delivered; **fresh-account and physical release acceptance remain
open**, so this ticket is ready for human validation rather than resolved.
No runtime code, configuration defaults or model selection was changed.

- [Installation runbook](../../../docs/installation.md): system prerequisites,
  locked user environments, exact model acquisition/verification references,
  provenance/terms, private XDG config, local-only Ollama, units/KDE shortcut,
  lifecycle, checks, updates/rollback and uninstall. Includes the unperformed
  fresh-account record and reproducible remaining procedure.
- [Release checklist](../../../docs/release-checklist.md): FR-01–FR-25 and M0–M4,
  mandatory gates, P1 deferrals, separate headset/speaker status and measured
  recognition/latency/resource/offline/stability evidence. Production Whisper's
  quality failure, unselected LLM, incomplete soak and remaining hardware gaps
  are explicit; no validated MVP release or approved latency revision is claimed.
- [Wake feasibility revisit](../../../docs/wake-activation.md#release-feasibility-revisit--2026-10-19)
  records source inspection, incomplete candidate/artifact/runtime/German testing
  and follow-up under #13. The interactive German library and actual microphone
  trials were not evaluated. Repeat after stable physical manual operation and
  before final hardware acceptance; #13 remains open, wake disabled.

Unchecked criteria retain their original acceptance meaning. Existing #14/#17/#18
physical gates are carried forward, not promoted to passes by documentation.

Map: [MVP implementation map](../map.md).
