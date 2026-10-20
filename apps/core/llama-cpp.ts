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

export async function generateAnswer(
  config: Config,
  operation: Operation,
  signal: AbortSignal,
  observation?: InferenceObservation,
): Promise<string> {
  let answer = '';
  let finished = false;
  let done = false;
  let pending = '';
  let skipLf = false;
  let data: string[] = [];
  let eventType = '';
  const dispatch = () => {
    if (eventType === 'error') throw new ProtocolError('invalid_message');
    eventType = '';
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    if (payload === '[DONE]') {
      if (!finished) throw new InferenceError('incomplete_stream');
      done = true;
      return;
    }
    const value = parseInferenceObject(payload);
    if (value.error || !Array.isArray(value.choices))
      throw new ProtocolError('invalid_message');
    observation?.usage(value.usage);
    // A usage-only chunk can follow the final choice.
    if (!value.choices.length && value.usage) return;
    if (value.choices.length !== 1) throw new ProtocolError('invalid_message');
    const choice = value.choices[0];
    observation?.finish(choice?.finish_reason);
    const delta = choice?.delta;
    if (
      finished ||
      choice?.index !== 0 ||
      !delta ||
      typeof delta !== 'object' ||
      Array.isArray(delta) ||
      (delta.role !== undefined && delta.role !== 'assistant') ||
      (delta.content != null && typeof delta.content !== 'string')
    )
      throw new ProtocolError('invalid_message');
    const content = delta.content ?? '';
    observation?.content(answer + content, delta.reasoning_content);
    if (delta.tool_calls || delta.function_call)
      throw new InferenceError('unsupported_response');
    if (!answer && content)
      diagnostic({
        event: 'llm_first_token',
        operation_id: operation.operation_id,
      });
    answer += content;
    if (
      Buffer.byteLength(answer) > Math.min(4096, config.llm.max_context_tokens)
    )
      throw new ProtocolError('frame_too_large');
    // Fail closed if a server ignores reasoning extraction and emits thought tags.
    if (/<\/?think(?:ing)?>/i.test(answer))
      throw new InferenceError('unsupported_response');
    if (choice.finish_reason != null) {
      if (!['stop', 'length'].includes(choice.finish_reason))
        throw new InferenceError('unsupported_response');
      finished = true;
    }
  };
  await readInference(
    config,
    '/v1/chat/completions',
    {
      model: config.llm.model,
      stream: true,
      messages: inferenceMessages(operation),
      max_tokens: config.llm.num_predict,
      temperature: config.llm.temperature,
      seed: config.llm.seed,
      stream_options: { include_usage: true },
      reasoning_format: 'deepseek',
    },
    AbortSignal.any([signal, AbortSignal.timeout(config.llm.timeout_ms)]),
    (chunk) => {
      observation?.activity();
      if (skipLf && chunk.startsWith('\n')) chunk = chunk.slice(1);
      skipLf = false;
      pending += chunk;
      while (!done) {
        const end = pending.search(/[\r\n]/);
        if (end < 0) break;
        const line = pending.slice(0, end);
        const cr = pending[end] === '\r';
        const crlf = cr && pending[end + 1] === '\n';
        skipLf = cr && end === pending.length - 1;
        pending = pending.slice(end + (crlf ? 2 : 1));
        if (!line) dispatch();
        else if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) eventType = line.slice(6).trim();
      }
      return !done;
    },
  );
  if (!done) throw new InferenceError('incomplete_stream');
  if (!answer.trim()) throw new InferenceError('empty_answer');
  return answer;
}

export type InferenceReadiness =
  | 'ready'
  | 'loading'
  | 'missing-model'
  | 'unavailable';

/** Both requests share a single deadline and never request generation or model loading. */
export async function probeInferenceStatus(
  config: Config,
): Promise<InferenceReadiness> {
  const signal = AbortSignal.timeout(config.transport.timeout_ms);
  const get = async (path: string, allowLoading = false) => {
    let body = '';
    const status = await readInference(
      config,
      path,
      undefined,
      signal,
      (chunk) => {
        body += chunk;
        return true;
      },
      allowLoading,
    );
    return { status, value: parseInferenceObject(body) };
  };
  try {
    const health = await get('/health', true);
    if (health.status === 503) {
      const error = health.value.error as
        | { code?: unknown; type?: unknown; message?: unknown }
        | undefined;
      return error?.code === 503 &&
        error?.type === 'unavailable_error' &&
        error?.message === 'Loading model'
        ? 'loading'
        : 'unavailable';
    }
    if (health.value.status !== 'ok') return 'unavailable';
    const models = (await get('/v1/models')).value;
    if (models.error || !Array.isArray(models.data)) return 'unavailable';
    return models.data.some((model) => model?.id === config.llm.model)
      ? 'ready'
      : 'missing-model';
  } catch {
    return 'unavailable';
  }
}
