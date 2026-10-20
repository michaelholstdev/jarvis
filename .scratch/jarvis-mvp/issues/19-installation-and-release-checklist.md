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

Validation on the existing checkout: `npm run check` passed (TypeScript/Biome,
Ruff and mypy); focused config/desktop-runtime tests passed 6/6; full `npm test`
passed **204 Node + 39 Python tests**. Local documentation link targets and all
25 requirement rows were checked. Initial sandbox cache/Git writes needed the
permitted rerun; no fresh-account or hardware check is implied.

### Standards

Independent review of `98157e6` against task-start baseline
`9a1af0917a7a38af77d6aed9a5231eb1f6caeea2`: no documented-standard violations
or material baseline smells. Installation commands match existing entrypoints,
units, configuration and manifests. **0 findings.**

### Spec

Independent review: **0 actionable documentation defects; partial acceptance
remains** for fresh-account installation, physical headset/speaker checks and the
post-stability wake investigation. These remain unchecked with reproduction and
follow-up links; no scope creep or misleading pass claims found. Subsequent edits
only record check/review results and whitespace cleanup.

Review summary: Standards 0 findings; Spec 0 actionable defects, with the above
acceptance gaps still open. No release sign-off is granted by either review.

Map: [MVP implementation map](../map.md).


### Runbook and release review follow-up — 2026-10-20

Claimed by Codex; user-confirmed scope: update the runbook and record the blocked
release decision. Review baseline: `0207ee5e6552755e7a64a5bd67eb6cfa8b8be30b`.
No fresh-account or hardware trial is included. Status remains ready-for-human.

The [runbook](../../../docs/installation.md) now leads with #20's pinned Parakeet
installation and optional Whisper alternative, makes provisional LLM/default
settings explicit, corrects the synthetic-check model directory, and provides
a content-free fresh-account lifecycle record format. No final #17 model selection
is invented.

The [dated release review](../../../docs/release-checklist.md#release-review--2026-10-20)
imports #12's scoped desktop observations, #23/#25 corrected reruns, #24's failed/
unsupported Jieli hardware mute, and #18's scoped bounds/audit follow-up. It reviews
#13/#14/#21 separately: wake and speaker success remain optional for a limited
manual headset release, and unvalidated spoken stop remains an explicit FR-09 gap.

**Release blocked; no approval.** Mandatory privacy and remaining locality/bounds/
cancellation acceptance, final #17 configuration, #12/#18 acceptance and the fresh
account lifecycle remain open. The human release owner and exact fresh-account
candidate are not selected. The waived two-hour idle duration remains waived,
without turning the partial observation into a full-duration or CPU pass. Original
unchecked criteria remain unchecked.

Map pointer: [MVP implementation map](../map.md).
