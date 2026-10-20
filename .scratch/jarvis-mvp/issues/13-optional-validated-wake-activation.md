# 13: Optional validated wake activation

**What to build:** Use “Hey Jarvis” followed immediately by a question only when a verified German-capable wake model passes documented tests; otherwise retain manual activation.

**Blocked by:** 12: Login startup, KDE activation, and device recovery — M3.

**Status:** ready-for-agent

**Claimed by:** Codex — 2026-10-20; user requested #13 implementation. Candidate/runtime feasibility first; physical #17 prerequisite and acoustic validation remain open.

## Comments

- 2026-10-19 #19 source-level feasibility revisit: upstream English model support
  and the custom German training/library route were rechecked. No specific model
  passed artifact/license/runtime/German checks; interactive library inventory,
  candidate pinning and actual German trials remain work. See the
  [dated review](../../../docs/wake-activation.md#release-feasibility-revisit--2026-10-19).
  Keep #13 open and repeat after stable physical manual operation, before final
  hardware acceptance; manual fallback does not close this ticket.

- 2026-10-16 follow-up decision: keep this ticket open for the actual wake
  implementation; the completed manual-only fallback does not resolve that work.
  Revisit after stable manual voice operation and before final release/hardware
  acceptance in #19. No duplicate issue is needed.
  - [ ] First run a feasibility investigation: select and pin a suitable model
    candidate, verify provenance/license/runtime, and evaluate German
    "Hey Jarvis, [immediate question]" recordings. Missing German validation is
    work to investigate, not evidence that implementation is impossible.
  - [ ] If the candidate is promising, implement the detector, bounded pre-roll,
    uninterrupted command handoff and measurement runner, then run the German
    acceptance protocol separately on headset and speakers.
  - [ ] Record the outcome before #19's final acceptance: validated wake for each
    supported setup, or concrete failed criteria/remaining work and a linked
    follow-up. Keep manual activation available; this revisit does not make
    successful wake validation a blocker for the manual-only release.

- Implementation baseline: `5e232b0204953e63a7b4edc2994442ab5d84a12c`.
  User confirmed config-loader and CLI/health test seams. No German-validated
  wake model is pinned; use the ticket's explicit manual-only fallback. Ticket
  #12 target-desktop acceptance remains open and is not bypassed by this work.

- [ ] Record model licensing, provenance, exact revision/checksum, supported ONNX runtime, and German capability before enabling wake mode; missing/unvalidated models remain disabled by default.
- [ ] Real wake detection preserves bounded pre-roll and trailing command audio, including a question spoken directly after the phrase without clipping.
- [ ] Wake acknowledgment cannot discard the immediate question, and idle still performs no STT/LLM work unless valid activation occurs.
- [ ] Measure recall, false accepts, clipping, and wake-to-listening transition timing with the actual microphone using a defined German test set and representative noise/TV/music/assistant playback.
- [ ] Publish headset and speaker results separately with model/threshold/device/settings and reproducible commands; never assume English pretrained weights establish German reliability.
- [x] Document model acquisition/verification, installation/configuration, threshold calibration, validation commands, enable/disable, and fallback troubleshooting. Current unsupported installation/enablement and future runner gaps are explicit.
- [x] This ticket does not block the manual-only release; if validation cannot pass, publish the evidence and remaining gaps, keep wake disabled, and make no hands-free acceptance claim.

## Answer

Completed the ticket's **manual-only fallback**. No German-validated model has
been selected, and no wake detector/handoff has been implemented. Wake stays
unavailable in every mode. Both config loaders now explain how to restore manual
activation when a non-null model path or threshold is supplied, without exposing
its value. The existing strict null-only schema remains the enablement barrier.

[Wake activation evidence and protocol](../../../docs/wake-activation.md) records
the upstream candidate's English-only evidence, missing artifact/runtime pins,
licensing distinction, German phrase set, proposed calibration/acceptance gates,
reproducible fallback commands and separate **unvalidated** headset/speaker
records. It explicitly lists the real detector, bounded handoff, measurement
runner and actual-microphone validation as remaining work. No hands-free claim
is made; unchecked criteria above remain open for any future wake implementation.
Ticket #12's hardware gate and M3 also remain open.

Validation: focused TypeScript and Python loader/CLI tests observed the old
diagnostics failing before the fixes and now pass. `npm run check` passes.
Full `npm test` passes **183 Node + 10 Python tests**. The initial sandboxed
run could not run socket-based tests; the permitted local-socket rerun passed.

Review of implementation commit `4422cdf` against the baseline above:

- **Standards:** no findings; schema validation, glossary vocabulary and
  content-free diagnostics retained; no actionable baseline smells.
- **Spec:** no findings against the explicitly permitted manual-only fallback;
  missing wake implementation and hardware measurements remain disclosed and
  unchecked. This review does not establish hands-free acceptance.

Map: [MVP implementation map](../map.md).


### Candidate implementation follow-up — 2026-10-20

User requested #13 implementation and confirmed config/CLI, daemon/audio socket,
and recording-evaluation CLI test seams. Review baseline:
`782c87001fa3e563561209403beac17599c08512`. Claimed for candidate/runtime
feasibility and implementation conditional on a promising candidate. The existing
#17 physical/manual prerequisite remains open; no physical acceptance is bypassed.

Implemented offline candidate preparation/evaluation and an explicitly started
headset calibration recorder in `benchmarks/wake`. Optional openWakeWord 0.6.0
and CPU ONNX Runtime dependencies are locked. Official v0.5.1 classifier, mel
and embedding assets are recorded with IDs, update times, terms and observed
SHA-256 values; upstream provides no independent digest, so provenance approval
is incomplete. Real inference ran on Python 3.11 / ONNX Runtime 1.31.0 CPU.

The reproducible German single-speaker screen has 30 immediate-question
positives and 90 ordinary/near-miss negatives. At threshold 0.5: 0/30 detections,
9 false activations over 380.66 negative seconds. Exploratory threshold 0.01 on
the same calibration corpus: 30/30 detections but 29 false activations. Neither
setting passes the screen; these results do not establish human performance or
prove that a different model/threshold cannot work. See the [current report and
commands](../../../docs/wake-activation.md#offline-candidate-evaluation--2026-10-20).

The user agreed to preparation of a short headset trial. A 20-clip, eight-second
per-clip recorder waits for Enter before each capture, writes only local private
files, checks software mute/KDE lock/sleep/source state, and marks interrupted
sessions incomplete. It has not been run on the physical microphone. Its polling
checks are not measured production privacy acceptance.

**#13 remains open; wake remains unavailable in the service.** Human calibration
and separate held-out recordings, a promising German-capable candidate, independent
artifact verification, resident bounded pre-roll/continuous handoff and socket
privacy/cancellation tests remain. No service configuration or default was changed.
The candidate evidence does not justify implementing/enabling the production
detector/handoff yet. Manual activation remains available.

Map: [MVP implementation map](../map.md).


### Validation and independent review

`npm run check` passed TypeScript, Biome, Ruff and both mypy checks. Full
`npm test` passed **208 Node / 53 Python tests**, including the optional real
candidate truncated-WAV regression. CLI tests cover stale-report invalidation,
invalid thresholds, interrupted recording manifests and muted-source refusal.
TDD observed stale-report, malformed-threshold and truncated-WAV failures before
fixes. The actual configured headset source passed a read-only desktop/source
preflight; no physical recording was opened.

Independent review of `7e6308a` against
`782c87001fa3e563561209403beac17599c08512`:

- **Standards:** 0 documented-standard violations and no substantive heuristic
  smells. CPU inference, content-free reports, artifact/dependency pins and
  explicit manual fallback follow repository standards.
- **Spec:** 0 actionable defects. Feasibility tooling and user-requested trial
  preparation match the conditional ticket scope. Production detector/handoff,
  human German validation, artifact approval and physical acceptance remain
  unfinished and explicitly disclosed. No scope creep or invented pass found.

Worst issue within either review axis: none. These reviews do not close #13 or
establish acoustic/privacy acceptance. The user's preexisting tracker edits
were preserved outside the implementation commits.
