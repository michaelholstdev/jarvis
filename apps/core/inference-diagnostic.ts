import { performance } from 'node:perf_hooks';
import {
  type Diagnostic,
  ProtocolError,
} from '../../packages/protocol/index.js';

export type InferenceFailure =
  | 'empty_answer'
  | 'timeout'
  | 'connection_failure'
  | 'http_failure'
  | 'malformed_stream'
  | 'incomplete_stream'
  | 'unsupported_response'
  | 'output_size_limit';

export class InferenceError extends ProtocolError {
  constructor(
    public readonly category: InferenceFailure,
    code: Diagnostic = 'invalid_message',
  ) {
    super(code);
  }
}

/** Stores only allowlisted scalars, never response objects or content. */
export function inferenceObservation() {
  const started = performance.now();
  const fields: Record<string, string | number> = {
    finish_reason: 'unknown',
    prompt_tokens: 'unknown',
    completion_tokens: 'unknown',
    total_tokens: 'unknown',
    answer_chars: 0,
    reasoning_chars: 'unknown',
    first_stream_ms: 'unknown',
    first_answer_ms: 'unknown',
  };
  return {
    fields,
    activity() {
      if (fields.first_stream_ms === 'unknown')
        fields.first_stream_ms = performance.now() - started;
    },
    content(answer: string, reasoning: unknown) {
      fields.answer_chars = answer.length;
      if (answer && fields.first_answer_ms === 'unknown')
        fields.first_answer_ms = performance.now() - started;
      if (typeof reasoning === 'string')
        fields.reasoning_chars =
          (typeof fields.reasoning_chars === 'number'
            ? fields.reasoning_chars
            : 0) + reasoning.length;
    },
    finish(reason: unknown) {
      if (
        [
          'stop',
          'length',
          'tool_calls',
          'function_call',
          'content_filter',
        ].includes(String(reason))
      )
        fields.finish_reason = String(reason);
    },
    usage(value: unknown) {
      if (!value || typeof value !== 'object') return;
      for (const key of [
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
      ] as const) {
        const count = (value as Record<string, unknown>)[key];
        if (
          typeof count === 'number' &&
          Number.isSafeInteger(count) &&
          count >= 0
        )
          fields[key] = count;
      }
    },
  };
}
export type InferenceObservation = ReturnType<typeof inferenceObservation>;

export function inferenceFailure(error: unknown): InferenceFailure {
  if (error instanceof InferenceError) return error.category;
  if (error instanceof ProtocolError) {
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'frame_too_large') return 'output_size_limit';
    if (error.code === 'invalid_message') return 'malformed_stream';
  }
  return 'connection_failure';
}
