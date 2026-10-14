# 14: Spoken stop and acoustic acceptance

**What to build:** Say standalone “Stopp” during a spoken reply to silence playback and continue in the normal follow-up window, with manual cancellation retained when voice stop is unreliable.

**Blocked by:** 09: Manual microphone question and scripted spoken reply — M1.

**Status:** ready-for-agent

- [ ] Provide bounded microphone processing for the narrowly scoped stop control during playback without enabling general voice barge-in or indefinite ambient transcription.
- [ ] Only a validated standalone spoken “Stopp” stops the reply; quoted/embedded words, playback echo, and VAD activity alone do not establish a control intent.
- [ ] Voice stop cancels remaining reply work, retains delivered-reply semantics, and starts the default follow-up window when playback stops.
- [ ] Manual cancellation remains usable independently of voice recognition; cancellation and late-result protections are exercised through the existing public interface.
- [ ] Acoustic tests on the actual headset and speakers report stop-detection reliability, response delay, and false stops during representative assistant/background playback, with reproducible fixtures and settings.
- [ ] Record spoken-stop FR-09 as passed, failed, or unvalidated separately for each setup; manual-only cancellation cannot pass the spoken criterion. If unreliable, document the gap and retain manual controls without claiming general barge-in.
- [ ] Document any needed local control-recognition dependencies/models, licenses/checksums, installation/configuration, test commands, enable/disable behavior, calibration limits, and safe fallback.
