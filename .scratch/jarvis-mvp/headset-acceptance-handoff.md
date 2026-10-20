# Start #17 in a fresh context

The user requested closing #18's delivered work, clearing conversation context and
starting #17. Preparation is complete; physical trials have not started.

1. Read `AGENTS.md`, `docs/agents/issue-tracker.md`, and the current outcome/active
   next-task section in [#17](issues/17-latency-and-resource-benchmarks.md).
   Before domain work, follow `docs/agents/domain.md`.
2. Record `git rev-parse HEAD` and `git status --short`. Preserve existing tracker
   preparations, speaker ticket and local wake calibration/validation records.
3. Read [latency protocol](../../docs/latency-benchmarks.md). Inspect current
   configuration, service health and device inventory without changing them.
   Confirm the actual headset/input/output and that the user is ready to speak
   before starting physical capture, playback or service reconfiguration.
4. Start with a short real headset conversation: manual cue, German/technical
   question, contextual follow-up, manual cancellation/replacement and explicit
   ending. Record candidate/configuration, observations and verdicts without
   conversation content. Resolve concrete failures before the full matrix.
5. Continue #17's quality/model comparison and required 30 warm queries plus
   remaining cold/long/noisy/whisper/load scenarios. Signal-proxy timings remain
   separate from physical audible latency; human German quality ratings remain
   separate from required-word screens. Final model selection needs both.

Current facts: Parakeet production integration (#20) and wake (#13) are delivered.
Wake defaults enabled at threshold 0.2; the user accepts measured 23/30 (76.7%)
headset recall experimentally. Preserve defaults and threshold unless instructed
otherwise. #17 can use manual activation; record actual configuration. Spoken-stop
acoustics are #14; speaker acceptance is #21. Hardware mute for the Jieli device
is unsupported (#24), while software mute remains a distinct check.

#18 implementation and review fixes end at `ee483ce`; checks pass (211 Node /
65 Python). Its closure grants no full stability/privacy/release pass. Remaining
acceptance gaps are carried in [#19](issues/19-installation-and-release-checklist.md),
with desktop/privacy evidence in #12 and chosen-setup conversation work in #17.
See [capture evidence](../../docs/capture-buffer-evidence.md) if those observations
are needed. Keep the two-hour idle waiver and historical 44.02-minute observation.
