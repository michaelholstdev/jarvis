import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';

export type Diagnostic =
  | 'invalid_message'
  | 'incompatible_version'
  | 'frame_too_large'
  | 'timeout'
  | 'unavailable'
  | 'busy';
export type Inhibitions = {
  locked: boolean;
  muted: boolean;
  hardware_muted: boolean;
};
export type InhibitionSource = keyof Inhibitions;
export type Capability = 'wake' | 'stt' | 'tts' | 'inference';
export type Capabilities = Record<Capability, 'mock' | 'ready' | 'unavailable'>;
export type HealthStatus = {
  capabilities: Capabilities;
  retry_available: boolean;
  last_failure: { code: Diagnostic; capability: Capability | 'audio' } | null;
  inhibitions: Inhibitions;
  privacy_pending: boolean;
  audio_cleanup_pending: boolean;
  ready: boolean;
  mode: 'mock';
  state:
    | 'idle'
    | 'acknowledging'
    | 'listening'
    | 'thinking'
    | 'synthesizing'
    | 'speaking'
    | 'follow-up'
    | 'awaiting-extension'
    | 'cancelling'
    | 'indicating-failure';
  manual_activation: 'unavailable' | 'mock';
  voice_conversation: 'unavailable';
  audio: 'ready' | 'unavailable';
  audio_diagnostic: Diagnostic | null;
  since_ms: number;
  state_since_ms: number;
};
export type ConversationExchange = { question: string; reply: string };
export type Operation = {
  type:
    | 'privacy'
    | 'indicate-failure'
    | 'cancel'
    | 'acknowledge'
    | 'recognize'
    | 'infer'
    | 'synthesize'
    | 'play'
    | 'close-conversation';
  operation_id: string;
  inhibitions?: Inhibitions;
  target_operation_id?: string;
  text?: string;
  sound?: boolean;
  context?: ConversationExchange[];
};
export type PlaybackReport = { completed: boolean; delivered_chars: number };
export type Message =
  | {
      version: 1;
      type: 'inhibition-changed';
      source: InhibitionSource;
      active: boolean;
    }
  | { version: 1; type: 'activate' | 'stop' }
  | { version: 1; type: 'demo'; text: string }
  | {
      version: 1;
      type: 'audio-operation';
      operation: Omit<Operation, 'type'> & {
        type: Exclude<Operation['type'], 'infer'>;
      };
    }
  | {
      version: 1;
      type: 'audio-result';
      operation_id: string;
      text?: string;
      completed?: boolean;
      delivered_chars?: number;
    }
  | { version: 1; type: 'hello'; role: 'core' | 'cli' }
  | {
      version: 1;
      type: 'ready';
      service: 'audio';
      mode: 'mock' | 'piper';
      capabilities?: Partial<Capabilities>;
    }
  | {
      version: 1;
      type: 'ready';
      service: 'core';
      status: HealthStatus;
    }
  | { version: 1; type: 'error'; code: Diagnostic };
const schema = JSON.parse(
  readFileSync(
    new URL(
      '../../../packages/protocol/schemas/message.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const validate = new Ajv().compile<Message>(schema);

export class ProtocolError extends Error {
  constructor(public readonly code: Diagnostic) {
    super(code);
  }
}

export function parseMessage(frame: Buffer): Message {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame),
    );
  } catch {
    throw new ProtocolError('invalid_message');
  }
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version !== 1
  ) {
    throw new ProtocolError('incompatible_version');
  }
  if (!validate(value)) throw new ProtocolError('invalid_message');
  return value;
}

export function encodeMessage(message: Message): string {
  return `${JSON.stringify(message)}\n`;
}
