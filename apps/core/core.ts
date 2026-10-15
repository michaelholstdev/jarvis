import type {
  ConversationExchange,
  Diagnostic,
  HealthStatus,
  InhibitionSource,
  Operation,
  PlaybackReport,
} from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import { type Config, loadConfig } from './config.js';

export type ServiceEvent =
  | { type: 'inhibition-changed'; source: InhibitionSource; active: boolean }
  | { type: 'privacy-applied'; operation_id: string }
  | { type: 'audio-ready' }
  | { type: 'audio-lost'; diagnostic?: Diagnostic }
  | {
      type: 'recognized' | 'inferred' | 'control-recognized';
      operation_id: string;
      text: string;
    }
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
  const inhibitions = { locked: false, muted: false, hardware_muted: false };
  let privacyPending = false;
  const inhibited = () => Object.values(inhibitions).some(Boolean);
  let readinessChangedAt = clock.now();
  let stateChangedAt = readinessChangedAt;
  let deadline = 0;
  let followUpDeadline: number | null = null;
  let conversationDeadline: number | null = null;
  const extensionPrompt =
    'Möchtest du weitermachen? Sag „Weiter“ oder „Gespräch beenden“.';
  let state: HealthStatus['state'] = 'idle';
  let diagnostic: Diagnostic | null = 'unavailable';
  let operation: Operation | undefined;
  let sequence = 0;
  let cancellation: { replacement: boolean; playback: boolean } | null = null;
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
          : next === 'speaking' || type === 'play'
            ? 120000
            : config.transport.timeout_ms);
  };
  const reset = () => {
    cancellation = null;
    answer = '';
    question = '';
    context = [];
    followUpDeadline = null;
    conversationDeadline = null;
    reply = null;
    transition('idle');
  };
  const close = () => {
    reset();
    if (ready) transition('idle', 'close-conversation');
  };
  const expired = () =>
    conversationDeadline !== null && clock.now() >= conversationDeadline;
  const promptForExtension = () => {
    followUpDeadline = null;
    transition('awaiting-extension', 'synthesize', extensionPrompt);
  };
  const finishTurn = () => {
    if (expired()) promptForExtension();
    else {
      transition('follow-up', 'recognize');
      followUpDeadline = deadline;
    }
  };
  const resumeFollowUp = () => {
    if (followUpDeadline === null || clock.now() >= followUpDeadline) close();
    else if (expired()) promptForExtension();
    else {
      transition('follow-up', 'recognize');
      deadline = followUpDeadline;
    }
  };
  const bounded = (text: string) =>
    text.trim().length > 0 &&
    Buffer.byteLength(text) <= Math.min(4096, config.llm.max_context_tokens);
  const retainDelivery = (report: PlaybackReport) => {
    if (
      !Number.isInteger(report.delivered_chars) ||
      report.delivered_chars < 0 ||
      report.delivered_chars > answer.length ||
      (report.completed && report.delivered_chars !== answer.length) ||
      (report.delivered_chars > 0 &&
        report.delivered_chars < answer.length &&
        /[\uD800-\uDBFF]/.test(answer[report.delivered_chars - 1] ?? ''))
    )
      return false;
    reply = {
      completed: report.completed,
      delivered_chars: report.delivered_chars,
      text: answer.slice(0, report.delivered_chars),
    };
    if (reply.text) {
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
    }
    answer = '';
    question = '';
    return true;
  };
  const listen = () => {
    followUpDeadline = null;
    if (config.interaction.activation_sound)
      transition('acknowledging', 'acknowledge');
    else transition('listening', 'recognize');
  };
  const cancel = (replacement: boolean) => {
    const previous = operation;
    if (!previous) return;
    cancellation = { replacement, playback: previous.type === 'play' };
    followUpDeadline = null;
    transition('cancelling', 'cancel');
    if (operation) operation.target_operation_id = previous.operation_id;
  };
  const synchronizePrivacy = () => {
    reset();
    privacyPending = true;
    transition('idle', 'privacy');
    if (operation) operation.inhibitions = { ...inhibitions };
  };
  return {
    stop(): void {
      if (state === 'speaking') cancel(false);
    },
    activate(): void {
      if (!ready || inhibited() || privacyPending)
        throw new ProtocolError('unavailable');
      if (['thinking', 'synthesizing', 'speaking'].includes(state)) {
        cancel(true);
        return;
      }
      if (state !== 'idle' && state !== 'follow-up')
        throw new ProtocolError('busy');
      if (state === 'idle') {
        reset();
        conversationDeadline =
          clock.now() + config.session.max_duration_seconds * 1000;
      } else if (expired()) {
        promptForExtension();
        return;
      }
      listen();
    },
    dispatch(event: ServiceEvent): void {
      if (event.type === 'inhibition-changed') {
        if (inhibitions[event.source] !== event.active) {
          inhibitions[event.source] = event.active;
          synchronizePrivacy();
        }
        return;
      }
      if (event.type === 'audio-ready') {
        if (!ready) readinessChangedAt = clock.now();
        ready = true;
        diagnostic = null;
        if (privacyPending && operation?.type !== 'privacy')
          synchronizePrivacy();
        return;
      }
      if (event.type === 'audio-lost') {
        if (ready) readinessChangedAt = clock.now();
        ready = false;
        diagnostic = event.diagnostic ?? 'unavailable';
        privacyPending ||= inhibited();
        reset();
        return;
      }
      if (privacyPending) {
        if (
          event.type === 'privacy-applied' &&
          operation?.type === 'privacy' &&
          event.operation_id === operation.operation_id
        ) {
          privacyPending = false;
          transition('idle');
        } else if (
          event.type === 'tick' &&
          operation &&
          clock.now() >= deadline
        ) {
          if (ready) readinessChangedAt = clock.now();
          ready = false;
          diagnostic = 'timeout';
          reset();
        }
        return;
      }
      if (inhibited()) return;
      if (
        event.type !== 'tick' &&
        event.operation_id !== operation?.operation_id
      )
        return;
      // A current explicit end command wins over simultaneous timer expiry.
      if (
        event.type === 'recognized' &&
        operation?.type === 'recognize' &&
        isEndPhrase(event.text)
      ) {
        close();
        return;
      }
      if (
        state === 'follow-up' &&
        expired() &&
        (conversationDeadline ?? Infinity) <= deadline
      )
        promptForExtension();
      if ((state !== 'idle' || operation) && clock.now() >= deadline) {
        if (followUpDeadline !== null || state === 'awaiting-extension')
          close();
        else reset();
      }
      if (
        event.type === 'tick' ||
        !operation ||
        event.operation_id !== operation.operation_id
      )
        return;
      if (state === 'awaiting-extension') {
        if (event.type === 'synthesized' && operation.type === 'synthesize') {
          transition('awaiting-extension', 'play', extensionPrompt);
        } else if (
          event.type === 'playback-completed' &&
          operation.type === 'play'
        ) {
          if (
            !event.completed ||
            event.delivered_chars !== extensionPrompt.length
          )
            close();
          else {
            transition('awaiting-extension', 'recognize');
            deadline =
              clock.now() + config.session.extension_response_seconds * 1000;
          }
        } else if (
          event.type === 'recognized' &&
          operation.type === 'recognize'
        ) {
          if (normalizePhrase(event.text) === 'weiter') {
            conversationDeadline =
              clock.now() + config.session.extension_duration_seconds * 1000;
            finishTurn();
          } else {
            const responseDeadline = deadline;
            transition('awaiting-extension', 'recognize');
            deadline = responseDeadline;
          }
        }
        return;
      }
      if (event.type === 'control-recognized' && state === 'speaking') {
        if (normalizePhrase(event.text) === 'stopp') cancel(false);
      } else if (
        event.type === 'playback-completed' &&
        state === 'cancelling' &&
        cancellation
      ) {
        const pending = cancellation;
        if (
          pending.playback
            ? !retainDelivery(event)
            : event.delivered_chars !== 0
        ) {
          reset();
          return;
        }
        answer = '';
        question = '';
        cancellation = null;
        if (pending.replacement && !expired()) listen();
        else finishTurn();
      } else if (event.type === 'speech-started' && state === 'follow-up') {
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
        if (bounded(event.text)) {
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
        if (!retainDelivery(event)) {
          reset();
          return;
        }
        finishTurn();
      }
    },
    status(): HealthStatus {
      return {
        ready,
        inhibitions: { ...inhibitions },
        privacy_pending: privacyPending,
        mode: 'mock',
        state,
        manual_activation:
          ready && !inhibited() && !privacyPending ? 'mock' : 'unavailable',
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
              ...(operation.inhibitions
                ? { inhibitions: { ...operation.inhibitions } }
                : {}),
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
function normalizePhrase(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/das war’s/g, "das war's")
    .replace(/[,.!?;:]+$/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ');
}

function isEndPhrase(text: string): boolean {
  return [
    "danke jarvis das war's",
    'gespräch beenden',
    'gute nacht jarvis',
  ].includes(normalizePhrase(text));
}
