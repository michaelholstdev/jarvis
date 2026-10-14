import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';

export type Diagnostic =
  | 'invalid_message'
  | 'incompatible_version'
  | 'frame_too_large'
  | 'timeout'
  | 'unavailable'
  | 'busy';
export type HealthStatus = {
  ready: boolean;
  mode: 'mock';
  state: 'idle';
  manual_activation: 'unavailable';
  voice_conversation: 'unavailable';
  audio: 'ready' | 'unavailable';
  audio_diagnostic: Diagnostic | null;
  since_ms: number;
};
export type Message =
  | { version: 1; type: 'hello'; role: 'core' | 'cli' }
  | { version: 1; type: 'ready'; service: 'audio'; mode: 'mock' }
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
    value = JSON.parse(frame.toString('utf8'));
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
