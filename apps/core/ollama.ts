import { request as httpRequest } from 'node:http';
import type { Operation } from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import type { Config } from './config.js';

/** Loopback-only HTTP, no redirects, proxies, tools, downloads or fallback. */
async function call(
  config: Config,
  path: string,
  body: unknown,
  signal: AbortSignal,
  consume: (line: string) => void,
): Promise<void> {
  const endpoint = new URL(config.llm.base_url);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
  )
    throw new ProtocolError('unavailable');
  // Resolve localhost ourselves so its name cannot resolve outside loopback.
  if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
  endpoint.pathname = path;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = httpRequest(endpoint, {
    method: payload === undefined ? 'GET' : 'POST',
    signal,
    headers:
      payload === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
  });
  try {
    const response = await new Promise<import('node:http').IncomingMessage>(
      (resolve, reject) => {
        req.once('response', resolve);
        req.once('error', reject);
        req.end(payload);
      },
    );
    if (response.statusCode !== 200) {
      response.destroy();
      throw new ProtocolError('unavailable');
    }
    let pending = '';
    let bytes = 0;
    response.setEncoding('utf8');
    for await (const chunk of response) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1048576) throw new ProtocolError('frame_too_large');
      pending += chunk;
      if (body === undefined) continue;
      let end = pending.indexOf('\n');
      while (end >= 0) {
        const line = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        if (line) consume(line);
        end = pending.indexOf('\n');
      }
    }
    if (pending.trim()) consume(pending);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      signal.aborted && signal.reason?.name === 'TimeoutError'
        ? 'timeout'
        : 'unavailable',
    );
  } finally {
    req.destroy();
  }
}

function parse(line: string): Record<string, unknown> {
  try {
    const value = JSON.parse(line);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.error
    )
      throw new Error();
    return value;
  } catch {
    throw new ProtocolError('invalid_message');
  }
}

export async function generateAnswer(
  config: Config,
  operation: Operation,
  signal: AbortSignal,
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
      messages: [
        { role: 'system', content: 'Du bist Jarvis. Antworte auf Deutsch.' },
        ...(operation.context ?? []).flatMap((exchange) => [
          { role: 'user', content: exchange.question },
          { role: 'assistant', content: exchange.reply },
        ]),
        { role: 'user', content: operation.text ?? '' },
      ],
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
      const message = value.message as
        | { content?: unknown; tool_calls?: unknown }
        | undefined;
      if (
        done ||
        typeof value.done !== 'boolean' ||
        !message ||
        typeof message.content !== 'string' ||
        message.tool_calls
      )
        throw new ProtocolError('invalid_message');
      answer += message.content;
      if (
        Buffer.byteLength(answer) >
        Math.min(4096, config.llm.max_context_tokens)
      )
        throw new ProtocolError('frame_too_large');
      done = value.done;
    },
  );
  if (!done || !answer.trim()) throw new ProtocolError('invalid_message');
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
