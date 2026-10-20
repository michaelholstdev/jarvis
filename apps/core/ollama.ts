import type { Operation } from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import type { Config } from './config.js';
import { diagnostic } from './diagnostics.js';
import {
  InferenceError,
  type InferenceObservation,
} from './inference-diagnostic.js';
import { parseInferenceObject, readInference } from './inference-http.js';
import { inferenceMessages } from './inference-messages.js';

/** Loopback-only HTTP, no redirects, proxies, tools, downloads or fallback. */
async function call(
  config: Config,
  path: string,
  body: unknown,
  signal: AbortSignal,
  consume: (line: string) => void,
  observation?: InferenceObservation,
): Promise<void> {
  let pending = '';
  await readInference(config, path, body, signal, (chunk) => {
    observation?.activity();
    pending += chunk;
    if (body !== undefined) {
      let end = pending.indexOf('\n');
      while (end >= 0) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (line) consume(line);
        end = pending.indexOf('\n');
      }
    }
    return true;
  });
  if (pending.trim()) consume(pending);
}

function parse(line: string): Record<string, unknown> {
  const value = parseInferenceObject(line);
  if (value.error) throw new ProtocolError('invalid_message');
  return value;
}

export async function generateAnswer(
  config: Config,
  operation: Operation,
  signal: AbortSignal,
  observation?: InferenceObservation,
): Promise<string> {
  const timeout = AbortSignal.timeout(config.llm.timeout_ms);
  let answer = '';
  let done = false;
  await call(
    config,
    '/api/chat',
    {
      model: config.llm.model,
      stream: true,
      messages: inferenceMessages(operation),
      options: {
        num_ctx: config.llm.max_context_tokens,
        num_predict: config.llm.num_predict,
        temperature: config.llm.temperature,
        seed: config.llm.seed,
      },
    },
    AbortSignal.any([signal, timeout]),
    (line) => {
      const value = parse(line);
      observation?.finish(value.done_reason);
      observation?.usage({
        prompt_tokens: value.prompt_eval_count,
        completion_tokens: value.eval_count,
      });
      const message = value.message as
        | { content?: unknown; tool_calls?: unknown; thinking?: unknown }
        | undefined;
      if (
        done ||
        typeof value.done !== 'boolean' ||
        !message ||
        typeof message !== 'object' ||
        Array.isArray(message)
      )
        throw new ProtocolError('invalid_message');
      observation?.content(
        answer + (typeof message.content === 'string' ? message.content : ''),
        message.thinking,
      );
      if (message.tool_calls) throw new InferenceError('unsupported_response');
      if (typeof message.content !== 'string')
        throw new ProtocolError('invalid_message');
      if (!answer && message.content) {
        diagnostic({
          event: 'llm_first_token',
          operation_id: operation.operation_id,
        });
      }
      answer += message.content;
      if (
        Buffer.byteLength(answer) >
        Math.min(4096, config.llm.max_context_tokens)
      )
        throw new ProtocolError('frame_too_large');
      done = value.done;
    },
    observation,
  );
  if (!done) throw new InferenceError('incomplete_stream');
  if (!answer.trim()) throw new InferenceError('empty_answer');
  return answer;
}

/** Non-generating probe verifies the configured model is installed, without replay. */
export async function probeInference(config: Config): Promise<boolean> {
  let ready = false;
  try {
    await call(
      config,
      '/api/tags',
      undefined,
      AbortSignal.timeout(config.transport.timeout_ms),
      (line) => {
        const models = parse(line).models;
        if (!Array.isArray(models)) throw new ProtocolError('invalid_message');
        ready = models.some(
          (model) =>
            model &&
            (model.name === config.llm.model ||
              model.name === `${config.llm.model}:latest`),
        );
      },
    );
  } catch {
    return false;
  }
  return ready;
}
