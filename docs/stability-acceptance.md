# Offline and desktop stability acceptance (#18)

This report separates automated synthetic/socket evidence from physical desktop
acceptance. Hardware lock/mute, real unplug/replug, systemd restart, suspend/resume,
and acoustic spoken stop remain **unvalidated**. See the step-by-step
[desktop procedure](desktop-acceptance.md) and separate [spoken-stop gate](spoken-stop.md).
No physical device settings or desktop session are changed by the commands below.

## Idle duration waiver — 2026-10-19

The user waived repeating or completing the two-hour idle run after the existing
44.02-minute observation showed no reported anomalies. The two-hour duration is
no longer a closure requirement for #18 or its release checklist. This explicitly
changes the original two-hour stability gate; it does not establish a two-hour
pass or a final CPU verdict. Historical artifacts remain unchanged. Queue/buffer
bounds, idle privacy, physical recovery and the other acceptance checks remain
required. The long-run command below is available for optional future testing.

## Reproduction

Run from the repository root with the pinned Node/Python dependencies installed,
`npm run build` completed, PipeWire/PulseAudio available, the manifest's Whisper,
Silero and Piper files installed, and Gemma 3 270M already in the local Ollama
store. These commands never download a model. The published configuration uses
absolute paths on the measured machine; adjust them for another checkout.

```sh
npm run check
node --test dist/tests/ollama-daemon.test.js dist/tests/expiry.test.js \
  dist/tests/extension-runtime.test.js dist/tests/desktop-runtime.test.js \
  dist/tests/recovery-runtime.test.js dist/tests/privacy-runtime.test.js \
  dist/tests/delivered-context.test.js dist/tests/text-answer-runtime.test.js
.venv/bin/python -m unittest tests/stability_acceptance_test.py
```

The 30-turn socket case checks each next Ollama request contains the preceding
question and delivered answer, then verifies explicit ending removes text access.
Speech and Ollama are boundary fixtures in this case. Existing expiry tests use a
fake clock to verify five-minute allowances, repeated explicit renewal, context
retention, noise/empty recognition deadlines and cleanup. The extension runtime
case additionally exercises 30 seconds of real time across core/Python sockets.
These are software checks, not a human-rated prolonged German conversation.

For real voice idle, create a private silent sink (retain the returned module ID).
Do not change the default source/sink. Stop competing acceptance runs before
removing this sink; remove only the module created by this procedure.

```sh
pactl load-module module-null-sink sink_name=jarvis_stability_18 rate=48000
.venv/bin/python -m benchmarks.stability.idle \
  --config benchmarks/stability/voice-config.json \
  --seconds 7200 --interval 5 --output benchmarks/stability/idle-two-hour.json
pactl unload-module MODULE_ID_FROM_FIRST_COMMAND
```

The runner synthesizes a fixed German question, feeds it through the private
monitor source, requires an actual answer, then closes via mute/unmute. This
measures **idle after privacy cleanup**, including worker teardown; it is not a
claim that STT/TTS worker models remain resident for two hours. It polls public
health/text access and sums service process-tree CPU/RSS every five seconds.
CPU accounting includes reaped-child ticks, so exited workers cannot erase consumed
CPU. A decreasing cumulative counter makes the resource verdict unvalidated;
process inspection failure aborts the run. Five-second sampling cannot establish
instantaneous CPU or RSS peaks between samples. Ollama is separately managed and excluded from these resource totals. Logs drain
to byte/line/operation counters; no raw lines or conversation content are saved.

Predeclared diagnostic screens: average CPU ≤5% of one core, final-minus-initial
summed RSS ≤32 MiB, and log growth ≤1024 bytes/minute plus 1024 startup bytes.
These are acceptance-runner screens, not new product resource promises. Reports are initialized as incomplete before work starts, and failures overwrite
prior passing reports with a failed execution verdict. Zero, negative and non-finite
timing values also invalidate old evidence before returning a CLI usage error.
Offline voice evidence is
also invalidated at startup and requires the current command to succeed. Resource
screens require ≥60 seconds; shorter command checks cannot pass the two-hour gate.
RSS endpoint growth is not proof of a leak-free heap. Operation diagnostics and
closed text access do not establish erased heap contents. Internal queue/audio
buffer occupancy is not exported and remains **unvalidated**; the report does not
turn low RSS into a queue/buffer pass. Fixed-sentinel log screening is narrow;
existing privacy suites provide separate content-logging regression coverage.

For disconnected external networking, use a disposable user/network namespace,
bring up only its loopback interface, and run a separate Ollama instance. The
runner refuses a namespace with another interface or external route. It copies
small manifests into temporary storage and links existing blobs individually;
`OLLAMA_NOPRUNE=1` prevents pruning and the system model store is not modified.
The desktop's networking, Ollama and default audio devices remain available.

```sh
unshare --user --map-root-user --net sh -c \
  'ip link set lo up && exec .venv/bin/python -m benchmarks.stability.offline --output benchmarks/stability/offline'
```

The offline command runs control/recovery/privacy/desktop/delivery/30-turn socket
suites and the actual latency voice harness with one initial plus 30 synthetic
questions. Natural follow-up capture, STT, loopback Ollama, Piper synthesis,
silent-sink playback and temporary text retrieval are real. Inhibition closes the
real voice session; explicit ending/extension are covered by separate socket
fixtures. This distinction matters: the script does not claim real spoken
extension/end recognition or semantic continuity from repeating independent
benchmark questions. The 30-turn fixture checks actual context contents.
The report checks **all** 30 measured turns plus the initial trial, rather than
using the voice command's exit status as proof of successful turns.

Tools are disabled and inference uses loopback. The namespace prevents successful
external traffic; an external-network syscall/attempt audit is **unvalidated**.
This is not a claim that blocking connectivity proves zero attempted requests.
Model usefulness and physical audibility remain unvalidated even if all synthetic
turns complete. Three short feasibility samples cannot pass a latency percentile
gate; the offline suite's goal is functionality without external connectivity.

## Environment and results

Measured 2026-10-19 on CachyOS Linux 7.2.11-1-cachyos, Node v24.11.1, Python
3.11.14; actual CPU/model/runtime inventories and hashes accompany the voice JSON.
The corrected run starts from `cc0f98271fe7543c52f30f6f70f303e0cd80274a`; production
service code remains identical to `1add1871d8002b36dd5a08e75213ebd72e5963a9`.
The collector is committed before the corrected run starts. The idle collector's launch hash/command is recorded separately in
`benchmarks/stability/idle-provenance.json`. Concurrent checks, editing, model
startup and offline voice benchmarking occurred during the observation; this is an
ordinary desktop workload, not a controlled empty machine.

| Scenario | Evidence | Verdict |
| --- | --- | --- |
| Two-hour idle after privacy closure | `benchmarks/stability/idle-two-hour.json` | waived 2026-10-19; prior run incomplete, 44.02-minute partial observation retained |
| 30 contextual socket turns, explicit ending | `tests/ollama-daemon.test.ts` | passed |
| Thirty real synthetic offline follow-ups | `benchmarks/stability/offline/voice.json` | passed: initial + 30 turns |
| Offline extension/text/privacy/recovery | `benchmarks/stability/offline/offline.json` | passed |
| Noise deadlines, extension, cancellation/delivered context | listed regression suites | passed |
| Queue/buffer occupancy and heap erasure | no direct acceptance instrumentation | unvalidated |
| Systemd restart, real mic/backend hotplug, suspend/resume | desktop procedure steps 7–9 | unvalidated |
| Physical lock/mute cessation and independent switches | desktop procedure steps 4–6 | unvalidated |
| Headset/speaker acoustic spoken stop | separate #14 hardware gate | unvalidated |

The user requested stopping the RAM observation after approximately 39 minutes.
The collector was interrupted and its final queued stdout checkpoint reports
**2640.92 seconds (44.02 minutes)**. Across 45 recorded minute checkpoints,
summed RSS began at **124.35 MiB**, peaked at **124.73 MiB**, and last measured
**113.39 MiB**; all checkpoints reported **zero idle log bytes**. RSS dropped to
about 108.36 MiB early and later rose about 5 MiB; these observations do not prove
a leak-free heap. The minute checkpoints are preserved in `idle-two-hour.json`.

**This is not a completed two-hour soak.** SIGINT cleaned up services but the
collector's full five-second sample set/final CPU and state verdicts were held in
memory and were not exported. The artifact explicitly records user-stopped,
`run_completed:false`, the narrower stdout observation method, and unvalidated
resource/two-hour gates. No final CPU, queue/buffer or memory-erasure pass is
claimed. A future full run remains available with the documented command.

Final offline run: **31.22 seconds** for the selected control suites and
**330.35 seconds** for the real synthetic voice harness. Both commands exit zero;
all 30 measured trials and the initial trial have monitored input/output signals.
The namespace contains only `lo`, with no external IPv4/IPv6 routes. Exact model
digest, speech hashes, configuration and runtime/hardware details are in the JSON.
These results establish disconnected synthetic operation, not human German
quality or physical headset/speaker acceptance. The fixed required-word screen
matches only **12/30** replies; no conversational model is selected from this run.
Active speech VRAM coverage is unvalidated (1 of
3188 samples unknown), despite zero allocation in
known samples. These gaps are not converted to passes by successful turn delivery.

## Setup failures and limitations

- The first focused Node run was denied local socket access by the sandbox; rerun
  with local socket permissions. This was an environment failure.
- The first 30-turn regression failed at two turns, then the expanded fixture hit
  its original two-second polling budget at 21 recognitions. Expanding the fixture
  transcript list and bounded polling allowance produced a passing 30-turn case.
- An initial idle smoke used a ten-second demo request timeout. A later smoke
  returned idle but did not verify that its seed produced an answer. **That early
  smoke is invalid as cleanup evidence.** Strengthening the seed check exposed
  that voice mode correctly ignores injected demo transcripts; the runner now
  feeds actual synthesized input. The two-hour run uses this corrected path.
- A sub-second mock command test briefly failed the CPU screen due to startup
  tick granularity. Resource verdicts now require at least 60 seconds. This changes
  no two-hour thresholds or samples.
- Initial namespace inspection used sysfs's host interface view and rejected the
  isolated namespace. It now uses namespace-aware `/proc/net/dev`.
- Starting Ollama against the shared store failed when it attempted to remove
  `manifests-v2` without permission. The corrected private store setup succeeded;
  no permission/ownership change was made to the shared store.
- Review found that live-process-only CPU counters could lose exited-worker CPU.
  The initial soak was aborted after at least 541 seconds of recorded idle samples
  and is **unvalidated**. The corrected collector includes reaped-child CPU and
  started a fresh run, later stopped at user request; no partial run is promoted
  to two-hour acceptance.
- Review also found failed reruns could retain prior passing output. New command
  tests reproduce that failure and verify incomplete/failed output replaces old
  evidence, including the offline voice artifact.
- The initial offline feasibility run completed its separate control suites in
  31.07 seconds and one initial plus three real synthetic turns in 41.78 seconds.
  Its artifacts are replaced by the full 30-turn run; these numbers are setup
  history, not the final acceptance results.

For each remaining physical scenario, record exact source/sink IDs, headset vs
speaker, model identities, before/after health, actual stop/recovery delay,
remaining inhibitions, text clearing and whether any canceled audio/question
replayed. Run during listening, inference, synthesis and playback. A missing
measurement stays unvalidated; any replay, ongoing capture while inhibited,
unbounded recovery or uncleared text is failed. Do not replace these observations
with a passing fixture result. M3 and physical stability acceptance remain open.

## Review and regression checks

`npm run check` passes. The full `npm test` run passes **204 Node tests and
39 Python tests**, including the new acceptance command failure/rerun cases.
No production changes followed those checks.

### Standards

No remaining documented-standard violations or material baseline smells. Review
found two collector correctness hazards (CPU loss on worker exit and stale offline
voice passes); both are fixed and independently rechecked. **0 remaining findings.**

### Spec

The stale-report finding is fixed and rechecked. **0 remaining implementation
defects; partial acceptance remains** for internal queue/buffer occupancy, external
request-attempt auditing and physical desktop/device checks. These are explicitly
unvalidated and keep the ticket's acceptance gate open.
