# #17 headset acceptance — 2026-10-20

Candidate: `003847bea329d3f97420d7e93b66e57895db00bb`.
Existing local tracker changes were present at task start and preserved: #12,
#13, #14, #16, #17, #18, #19 and map; untracked #21 and wake calibration/validation
records. No source change or new build was made for this trial. The existing
core build timestamp was 2026-10-20 12:07:57 CEST; running artifacts are not
independently proven byte-equivalent to the candidate source.

## Setup

User confirmed the selected headset microphone/output and readiness before
service restart and manual activation. Both user services were restarted with
the existing configuration; no device, gain, model or wake setting was changed.

- Input: `alsa_input.usb-Jieli_Technology_USB_Composite_Device_4150345930323108-00.pro-input-0`,
  Jieli USB Composite Device Pro, mono 48 kHz, 200% / +18.06 dB, unmuted.
- Output: `alsa_output.pci-0000_2f_00.4.analog-stereo`, Starship/Matisse,
  active port `analog-output-lineout`, stereo 48 kHz, 100%, unmuted.
  User confirmed headset use; device naming alone does not establish that routing.
- Parakeet TDT v3 INT8 and Piper Thorsten medium on CPU; Silero endpoint silence
  350 ms; pre-roll 750 ms; echo cancellation and voice stop disabled.
- LLM: `llama3:latest`, Q4_0, digest
  `365c0bd3c000a25d28ddbf732fe1c6add414de7275464c4e4d1c3b5fcb5d8ad1`;
  context 8192, output cap 512, temperature 0.3, seed 0. Ollama `/api/ps` was
  empty during preflight. This is not a controlled cold measurement.
- Wake enabled, threshold 0.2, experimental; all four capabilities ready after
  startup. Core health's `mode: mock` is hard-coded in `apps/core/core.ts` and
  cannot identify the actual configured audio/inference modes. Audio startup
  explicitly reported `voice`; configuration selects `voice` / `ollama`.
- Follow-up 20 s, duration allowance 300 s, extension 300 s / response 20 s.
- Config SHA-256: `5bad0c1fd67d6c76c713d041604433f7d371ab2f8ae120eb02e32e0005e419e6`.
- Model manifest SHA-256: `9bbfd10decb7cabb664fdf8feec0240b487b09d3521c1438924af1c4989a71d9`.
- uv lock SHA-256: `68d40155435c2b7f29141ff1bc82c769853a3c57aad69c2e2417c6be101a2eed`.
- npm lock SHA-256: `2a41e140888e91b29c51be9ea4ba8312d556a7b77237a5dde8335997fcd085ef`.

Actual Parakeet encoder/decoder/joiner/tokens, Silero and Thorsten model/config
files were hashed and match their entries in `config/models.json`. Speech hashes
are therefore identified by that exact manifest hash above. Wake artifacts were
not independently rehashed during this preflight.

## Manual trial 01 — incomplete, human observations pending

Planned sequence: activation cue, German technical question, contextual follow-up,
explicit ending. Manual cancellation/replacement follows in a separate trial.
No audio, transcripts, prompts or answers were retained by this acceptance note.

Content-free journal observations (Linux monotonic milliseconds):

| Event | Operation | Timestamp |
| --- | --- | ---: |
| Manual cancellation of idle wake started | 7 | 11875585.378329 |
| Wake cancellation completed | 7 | 11875631.932624 |
| Acknowledgment requested | 8 | 11875632.516277 |
| Acknowledgment playback started | 8 | 11879958.360354 |
| Acknowledgment playback completed | 8 | 11880130.070193 |
| Recognition requested | 9 | 11880130.873403 |
| Speech detected | 9 | 11883574.754907 |
| Endpoint | 9 | 11887201.927764 |
| Recognition final | 9 | 11887548.516259 |
| Returned to idle wake | 10 | 11887549.448808 |

No LLM or answer playback operation was observed in this attempt. The cause is
not established by content-free diagnostics. Human feedback is required before
attributing a failure or retrying the intended conversation. Acknowledgment
request to playback-start was about 4.326 s on this first activation; this is a
software timing observation, not independently measured physical audibility.

No completed conversational-quality sample or physical audible-latency sample
is claimed. No p50/p95, model-selection decision or acceptance pass is established.

## Subsequent wake activation — human observations pending

User feedback: the interaction went "okay", but the user felt they had to wait
after saying the wake phrase. This is an unscored qualitative observation;
whether the pause was before the question or before the answer is not yet clear.
Continuous wake-plus-question acceptance remains unvalidated. No cause is inferred.

Clarification: activation works, but the attached question is not correctly
executed and the reply sounds like a greeting. Focused diagnosis is tracked in
[#26](issues/26-wake-integrated-question.md); the earlier "okay" observation does
not pass the integrated-question check.

Configuration experiment for #26: local pre-roll changed from 750 to 1000 ms;
both services restarted and all capabilities became ready. Effective ring capacity
changes from 11776 samples (736 ms) to 15872 (992 ms), within the supported bound.
Other settings/artifacts remain unchanged. Config SHA-256 is now
`49a4586f5ae1ca5064ce8d4e962b5c6512af186d2d0e34bb14f76a3ed8885f8b`.
This prepares a new human rerun, not a historical correction or headset pass.

Human rerun feedback: the user reports that continuous wake-plus-question now
works "wesentlich besser". Retain 1000 ms pre-roll for subsequent trials. This
is qualitative improvement, without numerical quality ratings, a measured
audible-latency sample or a general wake handoff pass. Next short-trial item is
manual interruption/replacement, followed by explicit ending; full #17 quality
and measurement scenarios remain open.

After the first attempt, wake operation 10 detected activation at
`11935290.523506` ms. Recognition final was `11935647.868257`; inference operation
12 started at `11935648.553041`, first LLM token at `11941050.78306`, first TTS
audio (operation 13) at `11941396.265719`, and answer playback (operation 14)
started at `11941832.316486`. Playback delivery events followed. This establishes
an observed software answer path, not the requested manual-trial outcome or
human quality/audibility. Endpoint-to-first-playback was approximately 6.278 s;
the model was unloaded during preflight, but controlled cold conditions and the
physical end-of-user-speech boundary were not established. Do not pool this
observation into the warm audible-latency distribution.
