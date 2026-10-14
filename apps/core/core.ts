import type {
  Diagnostic,
  HealthStatus,
  Operation,
  PlaybackReport,
} from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import { type Config, loadConfig } from './config.js';

export type ServiceEvent =
  | { type: 'audio-ready' }
  | { type: 'audio-lost'; diagnostic?: Diagnostic }
  | { type: 'recognized' | 'inferred'; operation_id: string; text: string }
  | { type: 'synthesized'; operation_id: string }
  | ({ type: 'playback-completed'; operation_id: string } & PlaybackReport)
  | { type: 'tick' };

/** Public conversation boundary; one bounded operation, no event history or queue. */
export function createCore(
  clock: { now(): number },
  config: Config = loadConfig(),
) {
  let ready = false;
  let changedAt = clock.now();
  let deadline = 0;
  let state: HealthStatus['state'] = 'idle';
  let diagnostic: Diagnostic | null = 'unavailable';
  let operation: Operation | undefined;
  let sequence = 0;
  let answer = '';
  let reply: ({ text: string } & PlaybackReport) | null = null;
  const transition = (
    next: HealthStatus['state'],
    type?: Operation['type'],
    text?: string,
  ) => {
    state = next;
    changedAt = clock.now();
    operation = type
      ? {
          type,
          operation_id: String(++sequence),
          ...(text === undefined ? {} : { text }),
        }
      : undefined;
    deadline =
      changedAt +
      (next === 'listening'
        ? config.vad.max_utterance_seconds * 1000
        : config.transport.timeout_ms);
  };
  const reset = () => {
    answer = '';
    reply = null;
    transition('idle');
  };
  const bounded = (text: string) =>
    text.trim().length > 0 &&
    Buffer.byteLength(text) <= Math.min(4096, config.llm.max_context_tokens);
  return {
    activate(): void {
      if (!ready) throw new ProtocolError('unavailable');
      if (state !== 'idle') throw new ProtocolError('busy');
      reset();
      if (config.interaction.activation_sound)
        transition('acknowledging', 'acknowledge');
      else transition('listening', 'recognize');
    },
    dispatch(event: ServiceEvent): void {
      if (event.type === 'audio-ready') {
        if (!ready) changedAt = clock.now();
        ready = true;
        diagnostic = null;
        return;
      }
      if (event.type === 'audio-lost') {
        ready = false;
        diagnostic = event.diagnostic ?? 'unavailable';
        reset();
        return;
      }
      if ((state !== 'idle' || reply !== null) && clock.now() >= deadline)
        reset();
      if (
        event.type === 'tick' ||
        !operation ||
        event.operation_id !== operation.operation_id
      )
        return;
      if (event.type === 'playback-completed' && state === 'acknowledging') {
        if (event.completed && event.delivered_chars === 0)
          transition('listening', 'recognize');
        else reset();
      } else if (event.type === 'recognized' && state === 'listening') {
        if (bounded(event.text))
          transition('thinking', 'infer', event.text.trim());
        else reset();
      } else if (event.type === 'inferred' && state === 'thinking') {
        if (!bounded(event.text)) {
          reset();
          return;
        }
        answer = event.text;
        transition('synthesizing', 'synthesize', answer);
      } else if (event.type === 'synthesized' && state === 'synthesizing') {
        transition('speaking', 'play', answer);
      } else if (event.type === 'playback-completed' && state === 'speaking') {
        if (
          !Number.isInteger(event.delivered_chars) ||
          event.delivered_chars < 0 ||
          event.delivered_chars > answer.length ||
          (event.completed && event.delivered_chars !== answer.length)
        ) {
          reset();
          return;
        }
        reply = {
          text: answer.slice(0, event.delivered_chars),
          completed: event.completed,
          delivered_chars: event.delivered_chars,
        };
        answer = '';
        transition('idle');
      }
    },
    status(): HealthStatus {
      return {
        ready,
        mode: 'mock',
        state,
        manual_activation: ready ? 'mock' : 'unavailable',
        voice_conversation: 'unavailable',
        audio: ready ? 'ready' : 'unavailable',
        audio_diagnostic: diagnostic,
        since_ms: Math.max(0, clock.now() - changedAt),
      };
    },
    operations(): readonly Operation[] {
      return operation ? [{ ...operation }] : [];
    },
    reply() {
      return reply ? { ...reply } : null;
    },
  };
}
