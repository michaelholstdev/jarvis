# Persistent llama.cpp deployment — 2026-10-20

User authorized setup steps 1–3 after review of the unit drafts. Microphone
capture and the physical quality trial require a separate readiness signal.

The installed Jarvis path `~/.local/share/jarvis` resolves to this checkout.
Application source is `9e569dee14179370139c64636c19f6e5637eb22b`; `npm run build`
completed while both Jarvis units were stopped. No dependencies/model downloads
or changes to the independently managed Ollama service were performed.

Private backup of the prior config, Jarvis units/drop-ins and initial status:
`~/.local/state/jarvis/deployment-backups/20261020T120639Z/`.
The initial config already selected llama.cpp; no inference server was running.
Restoring that exact config alone would not select Ollama.

Installed files:

- `llama-server.service` copied to `~/.config/systemd/user/llama-server.service`.
- `llama-startup.conf` copied to
  `~/.config/systemd/user/jarvis-core.service.d/llama-startup.conf`.
- Existing `~/.config/jarvis/config.yaml`: explicit llama.cpp selection retained;
  `wake_word.enabled: false` added for manual-only setup/testing. Headset,
  speech models, generation settings and existing Node-path drop-in retained.

`systemd-analyze --user verify` passed. The model checksum matches the prior
acceptance record:
`3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1`.
The installed PrismML binary remains build 10777, commit `e3de71522`.

Enabled `llama-server.service` for `graphical-session.target`; the core also
Wants/After this service. No linger change. Started inference, verified readiness
and exact `jarvis-bonsai` model through the public non-generating adapter probe,
then started audio/core. Loopback listener is `127.0.0.1:18080`. Model/context
settings match the unit: Bonsai 27B PQ2_0, 8192 context, one slot, 99 requested GPU
layers, reasoning extraction deepseek. ROCm process fdinfo confirms PCI
`0000:2d:00.0`, VRAM 7,696,316 KiB after load. Layer-by-layer placement unmeasured.

Final setup check: all three services active, llama unit enabled; Jarvis health
`ready: true`, STT/TTS/inference ready, state idle, all inhibitions false,
manual activation and voice conversation ready. Wake is disabled. No `pw-record`
process exists; no recognition, playback or generation was requested in setup.
The user is asked for a separate start signal before a cued microphone trial.

Final-build physical German/context/cancellation trial passed with human
confirmation; see [acceptance evidence](../llama-cpp-acceptance-2026-10-20.md#final-build-installed-headset-acceptance--2026-10-20).
Wake remains explicitly disabled after the trial. An actual logout/login test
of automatic startup remains pending. Enabled unit/dependency checks alone do
not validate that login lifecycle. #17's full quality/model/latency matrix remains
separate.
