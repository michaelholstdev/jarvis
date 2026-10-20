# Stability acceptance follow-up — 2026-10-20 (#18)

Scope: tooling and automated evidence, as requested by the user. No new physical
trial or final #17 configuration selection is implied. Historical offline and
44.02-minute idle artifacts remain unchanged; the two-hour duration stays waived.

## Bounded admission and buffers

```sh
npm run build
uv run --frozen python -m benchmarks.stability.bounds \
  --output benchmarks/stability/bounds.json
uv run --frozen python -m unittest tests.network_audit_test
```

The bounds command records exit codes, durations and source hashes for existing
public socket/worker regressions, discarding stdout/stderr. Rebuild before running:
it executes compiled Node tests. Socket tests hold eight incomplete requests,
observe rejection of the ninth by both services, then observe timeouts freeing
capacity. They also check oversized complete/fragmented frames and that progress
cannot renew the response deadline. Worker checks cover privacy cancellation
across startup, rejection of stale admitted work and duration-limited speech.
Worker model/audio dependencies are fixtures. These checks do not measure native
model or physical-device buffer occupancy.

| Buffer/admission point | Bound and mechanism | Evidence limit |
| --- | --- | --- |
| Core/audio request admission | 8 default connections, configurable 1–32; excess closed | Real isolated sockets; kernel backlog separate |
| Protocol frame | 8192 bytes default, configurable up to 65536; absolute deadline | Framing/admission regressions; transient OS/stream allocations separate |
| Audio operation | One busy worker; concurrent work rejected; privacy invalidates prior admission and destroys worker | Worker-boundary regressions; no native heap-erasure claim |
| Input pre-roll | `floor(pre_roll_ms * 16 / 512)` frames of 512 float32 samples; current default 23 frames = 47,104 sample bytes | Source audit of `apps/audio/input.py`; excludes metadata/copies |
| Captured utterance | Capture loop stops at configured 30 seconds (maximum setting 120); 512-sample frames at 16 kHz | Wall-clock bound, not a measured maximum allocation/frame count |
| Synthesized speech | Accepted segments plus reserved notice limited to 60 seconds at voice rate; text limited to 4096 UTF-8 bytes and configured budget | Fixture duration regression; native Piper can allocate a rejected chunk before budget check |
| Ollama response | At most 1 MiB accepted response data; separate answer/context budgets | Source audit of `apps/core/ollama.ts`; no inference-server memory bound |

The original report below predates production capture instrumentation. See the
[scoped capture follow-up](capture-buffer-evidence.md) and its separate fixture
report for logical payload occupancy. Native resampler/VAD, synthesis chunks and
physical backend occupancy remain unmeasured. This is explicit partial bound
evidence; native audio occupancy and complete queue/buffer acceptance remain
**unvalidated**. Low RSS is not substituted for occupancy or erased heap contents.

## External connection attempts

The new command requires `strace` and launches the command supplied after `--`.
It follows descendants and counts `connect()` destinations, including failed
calls. It discards raw trace lines, destination addresses and child output, and
saves counters/verdicts only. Command arguments are not saved. Invalid/unknown
traces, tracer failure, timeout or missing tracer cannot yield a connection pass;
startup replaces any earlier report. AF_UNIX paths are counted without retention.
IPv4, IPv6 and IPv4-mapped IPv6 loopback are classified.

Inside the disposable loopback-only namespace in the [original protocol](stability-acceptance.md):

```sh
uv run --frozen python -m benchmarks.stability.network \
  --seconds 900 --output /tmp/jarvis-network-audit.json -- \
  .venv/bin/python -m benchmarks.stability.offline --output /tmp/jarvis-offline-audited
```

This traces the isolated Ollama launched by the runner and core/audio descendants.
A separately managed Ollama, desktop PipeWire server or other existing service is
outside coverage. Unconnected datagram sends and inherited network descriptors
are also outside coverage. Thus `all_external_request_attempts` always remains
**unvalidated**, even if `external_connection_attempts` passes. Exit zero means
only that narrower check passed. Blocked routes never establish zero attempts.

On this machine `strace` is absent. The retained `benchmarks/stability/network.json`
records failed execution (`FileNotFoundError`), with overall coverage unvalidated.
No actual request-attempt pass is claimed. External tracer fixtures verify failed
external connections are counted, loopback is classified, and unknown/empty traces
cannot reuse old passes; those results validate tooling only.

## Imported physical evidence from #12

Use the shared [2026-10-19 session](../.scratch/jarvis-mvp/desktop-acceptance-2026-10-19.md),
including its durable setup/events/observations and per-trial revision identities.
Initial candidate: `4b76547`; later trials and corrected reruns are identified
there. Setup: Jieli USB microphone, analog headphones, Parakeet v3 INT8, Piper
Thorsten medium and local `llama3:latest`. This differs from the historical
Whisper/Gemma silent-sink offline configuration.

| Shared scenario | Imported verdict and limit |
| --- | --- |
| Lock, source/CLI mute precedence and clearing | Observed scenarios passed; physical cessation latency unmeasured |
| Microphone reconnect, real suspend, backend/output transition | Recorded phases passed; untested permutations unvalidated |
| Existing-account login/shortcut and core crash/restart | Observed scenarios passed; no fresh-account installation claim |
| Audio crash/restart during playback | Initial resumed-capture failure retained; corrected #25 physical rerun passed without resumed capture or answer |
| Long spoken answer | #23 corrected headset rerun passed; not a prolonged conversation |
| Jieli hardware mute | Unsupported, independently investigated in [#24](../.scratch/jarvis-mvp/issues/24-jieli-hardware-mute-detection.md); source-mute success does not pass this gate |
| Five-minute idle privacy | Existing observation reused; no resource/long-soak inference |

Final #17 candidate selection, 30 physical contextual turns with extension,
disconnected chosen-setup trials, precise physical cessation delay and remaining
phase permutations stay open. These imported observations do not close #12/#18
or claim a release pass.

## Validation and review

`npm run check` passes. Full `npm test` passes **208 Node / 48 Python tests**.
The focused audit CLI suite passes five tests. The first external-attempt test
failed before the tool existed; the review's stale-report regression reproduced
three failed usage cases before the fix and passed afterward. The bounds evidence
command passed both public-contract groups. The real connection-audit invocation
failed because `strace` is missing; it is intentionally retained as failed evidence.

Review comparison: `git diff afc5ac098c2678b1e4eabab2608088eac62d9668...HEAD`,
covering implementation `983159f` and correction `16fc6e6`. Independent reviewers
rechecked the correction before the final full-suite run.

### Standards

Zero remaining findings. Shared audit-test setup resolves the initial low-priority
duplication concern. No new documented-standard violations or material privacy
concerns were found in the revised hunks.

### Spec

Zero remaining actionable findings. Invalid CLI usage now clears prior passing
audit evidence before argument validation can exit. Native occupancy, actual
tracing and physical acceptance remain explicitly unvalidated, consistent with
the approved tooling-only scope.

Standards: 0 findings; Spec: 0 actionable findings. No worst issue remains within
either axis; the acceptance gaps above remain open.

Production capture instrumentation follow-up: [method, scope and finite evidence](capture-buffer-evidence.md). Historical contract/network and physical evidence above is preserved.
