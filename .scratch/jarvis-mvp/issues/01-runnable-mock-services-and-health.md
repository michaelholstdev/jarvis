# 01: Runnable mock services and health — M0

**What to build:** Start the core and audio services without hardware, validate their configuration, exchange a typed local handshake, and inspect usable health from the CLI.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

Claimed by: Codex (2026-10-14)

Resolved: 2026-10-14

- [x] A minimal Node.js/TypeScript core and Python audio service run as separate processes, with a shared versioned protocol and deterministic service mocks.
- [x] The CLI reports readiness after a real Unix-socket mock handshake; malformed or incompatible messages produce useful content-free diagnostics.
- [x] Schema validation rejects invalid configuration and documents defaults for devices, models, local endpoints, timers, limits, interaction sounds, and disabled features.
- [x] Socket access is restricted to the current user; networking remains local, and no speech model, microphone, cloud fallback, or external tool is required.
- [x] Node and Python dependencies are reproducible through lockfiles and a project Python environment; a model-manifest structure can record exact revisions, checksums, licensing, and provenance without bundling unverified models.
- [x] Build, lint/type checks, and hardware-free unit/contract checks run locally and in CI; the conversation-core public testing interface supports scripted events and a fake clock.
- [x] Document prerequisites and exact install, environment setup, configure, start, stop, test, and health-inspection commands for both mock services, including missing-runtime diagnostics.
- [x] Keep M0 limited to the runnable foundation; do not add speculative speech integrations, external adapters, or general barge-in.

## Answer

Implemented the M0 foundation: separate Node/TypeScript core and Python audio
mock processes, versioned shared JSON schemas, validated YAML configuration,
private Unix sockets, fresh CLI health handshakes, bounded frames/connections and
timeouts, a scripted orchestration interface with an injected clock, reproducible
Node/Python environments, an empty model manifest with provenance schema, CI and
exact setup/start/stop/check instructions in the root README.

Manual activation and voice conversation remain explicitly unavailable. No
hardware, speech models, Ollama, cloud fallback or external tools are used.

Validation: `npm ci`, `uv sync --frozen`, `npm run doctor`, `npm run check`, and
`npm test` passed locally. The full suite passed five Node tests and two Python
tests, including real socket readiness, service loss/reconnect, malformed and
incompatible frames, permissions, connection capacity and slow-peer deadlines.
A controlled missing-runtime check returned the documented diagnostics.
CI is configured to run the same locked installs and checks; remote CI and
hardware acceptance have not been run.

Review against the supplied project-document baseline: Standards — zero findings;
Spec — one duplicate-YAML-key discrepancy, reproduced by a failing test, fixed
and confirmed resolved by the reviewer. No remaining actionable findings.

See the [implementation map](../map.md) and [README](../../../README.md).
