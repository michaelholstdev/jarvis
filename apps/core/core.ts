import type {
  ConversationExchange,
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
  | { type: 'speech-started'; operation_id: string }
  | { type: 'synthesized'; operation_id: string }
  | ({ type: 'playback-completed'; operation_id: string } & PlaybackReport)
  | { type: 'tick' };

/** Public conversation boundary; one bounded operation, no event history or queue. */
export function createCore(
  clock: { now(): number },
  config: Config = loadConfig(),
) {
  let ready = false;
  let readinessChangedAt = clock.now();
  let stateChangedAt = readinessChangedAt;
  let deadline = 0;
  let followUpDeadline: number | null = null;
  let state: HealthStatus['state'] = 'idle';
  let diagnostic: Diagnostic | null = 'unavailable';
  let operation: Operation | undefined;
  let sequence = 0;
  let answer = '';
  let question = '';
  let context: ConversationExchange[] = [];
  let reply: ({ text: string } & PlaybackReport) | null = null;
  const transition = (
    next: HealthStatus['state'],
    type?: Operation['type'],
    text?: string,
  ) => {
    state = next;
    stateChangedAt = clock.now();
    operation = type
      ? {
          type,
          operation_id: String(++sequence),
          ...(text === undefined ? {} : { text }),
          ...(type === 'close-conversation'
            ? { sound: config.interaction.conversation_end_sound }
            : {}),
          ...(type === 'infer'
            ? { context: context.map((exchange) => ({ ...exchange })) }
            : {}),
        }
      : undefined;
    deadline =
      stateChangedAt +
      (next === 'follow-up'
        ? config.session.follow_up_seconds * 1000
        : next === 'listening'
          ? config.vad.max_utterance_seconds * 1000
          : next === 'speaking'
            ? 120000
            : config.transport.timeout_ms);
  };
  const reset = () => {
    answer = '';
    question = '';
    context = [];
    followUpDeadline = null;
    reply = null;
    transition('idle');
  };
  const close = () => {
    reset();
    if (ready) transition('idle', 'close-conversation');
  };
  const resumeFollowUp = () => {
    if (followUpDeadline === null || clock.now() >= followUpDeadline) close();
    else {
      transition('follow-up', 'recognize');
      deadline = followUpDeadline;
    }
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
        if (!ready) readinessChangedAt = clock.now();
        ready = true;
        diagnostic = null;
        return;
      }
      if (event.type === 'audio-lost') {
        if (ready) readinessChangedAt = clock.now();
        ready = false;
        diagnostic = event.diagnostic ?? 'unavailable';
        reset();
        return;
      }
      if ((state !== 'idle' || operation) && clock.now() >= deadline) {
        if (followUpDeadline !== null) close();
        else reset();
      }
      if (
        event.type === 'tick' ||
        !operation ||
        event.operation_id !== operation.operation_id
      )
        return;
      if (event.type === 'speech-started' && state === 'follow-up') {
        transition('listening', 'recognize');
        // The onset keeps the same recognition identity; repeated onset cannot renew it.
        operation.operation_id = event.operation_id;
        deadline = Math.min(
          deadline,
          (followUpDeadline ?? clock.now()) +
            config.session.recognition_completion_seconds * 1000,
        );
      } else if (
        event.type === 'playback-completed' &&
        operation.type === 'close-conversation'
      ) {
        transition('idle');
      } else if (
        event.type === 'playback-completed' &&
        state === 'acknowledging'
      ) {
        if (event.completed && event.delivered_chars === 0)
          transition('listening', 'recognize');
        else reset();
      } else if (
        event.type === 'recognized' &&
        (state === 'listening' || state === 'follow-up')
      ) {
        if (isEndPhrase(event.text)) {
          close();
        } else if (bounded(event.text)) {
          question = event.text.trim();
          transition('thinking', 'infer', question);
        } else if (followUpDeadline !== null) resumeFollowUp();
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
        context.push({ question, reply: reply.text });
        while (
          context.reduce(
            (bytes, exchange) =>
              bytes +
              Buffer.byteLength(exchange.question) +
              Buffer.byteLength(exchange.reply),
            0,
          ) > config.llm.max_context_tokens
        )
          context.shift();
        answer = '';
        question = '';
        transition('follow-up', 'recognize');
        followUpDeadline = deadline;
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
        since_ms: Math.max(0, clock.now() - readinessChangedAt),
        state_since_ms: Math.max(0, clock.now() - stateChangedAt),
      };
    },
    operations(): readonly Operation[] {
      return operation
        ? [
            {
              ...operation,
              ...(operation.context
                ? {
                    context: operation.context.map((exchange) => ({
                      ...exchange,
                    })),
                  }
                : {}),
            },
          ]
        : [];
    },
    reply() {
      return reply ? { ...reply } : null;
    },
  };
}

/** Normalize spoken casing/punctuation, while preserving quotation marks. */
function isEndPhrase(text: string): boolean {
  const normalized = text
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/das war’s/g, "das war's")
    .replace(/[,.!?;:]+$/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ');
  return [
    "danke jarvis das war's",
    'gespräch beenden',
    'gute nacht jarvis',
  ].includes(normalized);
}
