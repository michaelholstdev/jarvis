import type { Operation } from '../../packages/protocol/index.js';
import type { Config } from './config.js';

/** Keep audio socket deadlines and the corresponding state watchdog in sync. */
export function audioDeadlineMs(
  config: Config,
  type?: Operation['type'],
): number {
  if (type === 'recognize' && config.audio.mode === 'voice')
    return (
      (config.vad.max_utterance_seconds +
        config.session.recognition_completion_seconds) *
      1000
    );
  return type === 'play' ||
    (config.audio.mode !== 'mock' &&
      [
        'synthesize',
        'acknowledge',
        'close-conversation',
        'indicate-failure',
      ].includes(type ?? ''))
    ? config.recovery.playback_timeout_ms
    : config.transport.timeout_ms;
}
