# 01: Runnable mock services and health — M0

**What to build:** Start the core and audio services without hardware, validate their configuration, exchange a typed local handshake, and inspect usable health from the CLI.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

Claimed by: Codex (2026-10-14)

- [ ] A minimal Node.js/TypeScript core and Python audio service run as separate processes, with a shared versioned protocol and deterministic service mocks.
- [ ] The CLI reports readiness after a real Unix-socket mock handshake; malformed or incompatible messages produce useful content-free diagnostics.
- [ ] Schema validation rejects invalid configuration and documents defaults for devices, models, local endpoints, timers, limits, interaction sounds, and disabled features.
- [ ] Socket access is restricted to the current user; networking remains local, and no speech model, microphone, cloud fallback, or external tool is required.
- [ ] Node and Python dependencies are reproducible through lockfiles and a project Python environment; a model-manifest structure can record exact revisions, checksums, licensing, and provenance without bundling unverified models.
- [ ] Build, lint/type checks, and hardware-free unit/contract checks run locally and in CI; the conversation-core public testing interface supports scripted events and a fake clock.
- [ ] Document prerequisites and exact install, environment setup, configure, start, stop, test, and health-inspection commands for both mock services, including missing-runtime diagnostics.
- [ ] Keep M0 limited to the runnable foundation; do not add speculative speech integrations, external adapters, or general barge-in.
