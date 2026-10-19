# 23: Long spoken answers fail at the audio duration limit

**Type:** Bug

**Status:** needs-triage

**Blocked by:** None for reproduction; decide bounded long-answer behavior before implementation.

## Observed failure

During #12 headset acceptance on candidate `4b76547`, the user reported an
activation cue followed by apparently unsuccessful processing. Content-free
journal events show recognition and inference completed, then synthesis failed
with `audio_runtime_failed` on multiple turns, including after core restart.

The private live answer was not retained. A synthetic reproduction at public
`Output.run` confirms a matching failure: a 1,120-character German answer exceeds
the worker's 60-second PCM duration limit despite fitting its 2,048-character
limit. This establishes the synthetic cause, not the precise contents/duration
of each live failure. A 112-character and 560-character control both succeeded;
the 1,120-character case failed repeatedly in fresh workers.

The repeatable synthetic sentence produces 3.286 seconds of audio with the pinned
Thorsten medium voice; twenty repetitions produce 65.712 seconds. Synthesis
raises `audio_too_large`, mapped to the generic `audio_runtime_failed` diagnostic.
No microphone, LLM or audible playback is needed to reproduce.

## Reproduction

With the installed private voice config and verified local models:

```sh
.venv/bin/python - <<'PY'
import asyncio
from apps.audio.main import load_config
from apps.audio.output import Output

async def main():
    output = Output(load_config())
    try:
        await output.run({
            'type': 'synthesize', 'operation_id': 'long-answer-repro',
            'text': 'Ein Computer verarbeitet Daten und führt Programme aus. ' * 20,
        })
    finally:
        await output.stop()

asyncio.run(main())
PY
```

Observed: `tts_first_audio`, `audio_runtime_failed`, `OutputError: unavailable`.
The command exits nonzero. Use two or ten repetitions for passing controls.

## Required outcome

- Handle long generated speech deliberately rather than losing the entire spoken
  answer behind a generic runtime failure. Decide whether to provide bounded
  speech with a full-text notice, use bounded segments, or another explicit policy.
- Keep audio memory, operation deadlines and cancellation bounded; do not silently
  remove duration limits or mark unheard content as delivered context.
- Preserve full temporary text availability and privacy cleanup requirements.
- Reproduce red/green at an agreed public seam and repeat the affected headset
  trial. Until resolved, use short answers for unrelated desktop acceptance and
  retain this failure in the final candidate evidence.

## Comments

Diagnosed during #12 acceptance, 2026-10-19. No code/config workaround applied.
The one-shot core SIGKILL test had separately completed at 12:19:53 UTC; systemd
restarted core after 15 seconds. No additional crash injector remains armed.

Map: [MVP implementation map](../map.md).
