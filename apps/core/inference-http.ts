import { request } from 'node:http';
import { ProtocolError } from '../../packages/protocol/index.js';
import type { Config } from './config.js';

/** Bounded loopback HTTP; returning false stops consumption and closes the stream. */
export async function readInference(
  config: Config,
  path: string,
  body: unknown,
  signal: AbortSignal,
  consume: (chunk: string) => boolean,
  allowLoading = false,
): Promise<number> {
  const endpoint = new URL(config.llm.base_url);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new ProtocolError('unavailable');
  if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1';
  endpoint.pathname = path;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = request(endpoint, {
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
    const status = response.statusCode ?? 0;
    if (status !== 200 && !(allowLoading && status === 503)) {
      response.destroy();
      throw new ProtocolError('unavailable');
    }
    response.setEncoding('utf8');
    let bytes = 0;
    for await (const chunk of response) {
      signal.throwIfAborted();
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1048576) throw new ProtocolError('frame_too_large');
      if (consume(chunk) === false) break;
    }
    signal.throwIfAborted();
    return status;
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

export function parseInferenceObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new ProtocolError('invalid_message');
  }
}
