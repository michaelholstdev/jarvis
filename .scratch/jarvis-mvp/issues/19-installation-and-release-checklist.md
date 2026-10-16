# 19: Reproducible installation and release checklist — M4

**What to build:** Install the supported Jarvis setup on a fresh CachyOS user account and inspect an honest requirement-level release checklist with known restrictions.

**Blocked by:** 14: Spoken stop and acoustic acceptance; 16: German recognition comparison; 17: End-to-end latency and resource benchmarks; 18: Offline and desktop stability acceptance.

**Status:** ready-for-agent

- [ ] Consolidate exact prerequisite, dependency, local-model/voice acquisition and verification, configuration, user-service installation, KDE shortcut, start/stop, health/log inspection, test, update, and uninstall instructions.
- [ ] Separate necessary system package steps from unprivileged user-service operation; document disabled linger, standard XDG locations, permissions, and local-only endpoint settings.
- [ ] Validate the documented manual-activation setup on a fresh CachyOS user account with the target hardware/desktop, documenting any step that cannot yet be reproduced.
- [ ] Map evidence to PRD FR-01 through FR-25 and M0–M4 gates, keeping P1 requirements deferred and marking each applicable requirement passed, failed, or unvalidated for its tested setup.
- [ ] Local inference, idle privacy, bounded capture, and cancellation are mandatory release gates; failing them prevents a release claim even if other features work.
- [ ] Manual activation can satisfy the MVP activation gate; unreliable spoken stop remains a disclosed FR-09 gap and a useful limited release must not claim every P0 requirement passed.
- [ ] Include measured recognition, latency/resource, stability, and offline evidence, explicit model/licensing/provenance details, and any reviewed latency-target revisions.
- [ ] Report headset and speaker support separately. Include optional wake results only if independently validated; ticket 13 is not a blocker and absent results are explicitly unvalidated/disabled.
- [ ] Before final release/hardware acceptance, revisit [#13](13-optional-validated-wake-activation.md) after stable manual voice operation: investigate model feasibility, then implement and validate wake if promising. Record either validated setup-specific results or concrete gaps and a linked follow-up; do not silently close #13 because its manual-only fallback was delivered. Successful wake validation remains optional for a manual-only release.
- [ ] Document dialect/dictation/language-switching, device/acoustic, model, text-lifetime, and distribution limitations; no cloud fallback, tools, tray dependency, persistent memory, or general barge-in is implied.
- [ ] Publishing release documentation does not turn unavailable hardware checks into passing results; retain unresolved evidence gaps and specify how to reproduce the remaining validation.
