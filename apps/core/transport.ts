import { createConnection, type Socket } from 'node:net';
import {
  encodeMessage,
  type Message,
  ProtocolError,
  parseMessage,
} from '../../packages/protocol/index.js';
import type { Config } from './config.js';

/** Each connection is one bounded request/response; no application queue. */
export function receive(
  socket: Socket,
  limits: Config['transport'],
  onProgress?: (message: Extract<Message, { type: 'speech-started' }>) => void,
): Promise<Message> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    let progressSeen = false;
    const finish = (error?: Error, message?: Message) => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('end', onEnd);
      socket.removeListener('close', onEnd);
      clearTimeout(timer);
      if (error) reject(error);
      else if (message) resolve(message);
    };
    const onError = () => finish(new ProtocolError('unavailable'));
    const onEnd = () => finish(new ProtocolError('unavailable'));
    const onData = (chunk: Buffer) => {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const newline = chunk.indexOf(10, offset);
          const end = newline < 0 ? chunk.length : newline + 1;
          const fragment = chunk.subarray(offset, end);
          if (data.length + fragment.length > limits.max_frame_bytes)
            throw new ProtocolError('frame_too_large');
          data = Buffer.concat([data, fragment]);
          if (newline < 0) return;
          const message = parseMessage(data.subarray(0, data.length - 1));
          data = Buffer.alloc(0);
          if (message.type !== 'speech-started')
            return finish(undefined, message);
          if (!onProgress || progressSeen)
            throw new ProtocolError('invalid_message');
          progressSeen = true;
          onProgress(message);
          offset = end;
        }
      } catch (error) {
        finish(error as Error);
      }
    };
    const timer = setTimeout(
      () => finish(new ProtocolError('timeout')),
      limits.timeout_ms,
    );
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
    socket.on('close', onEnd);
  });
}

export async function request(
  path: string,
  role: 'cli' | 'core',
  limits: Config['transport'],
  message: Message = { version: 1, type: 'hello', role },
  options: {
    signal?: AbortSignal;
    onProgress?: (
      message: Extract<Message, { type: 'speech-started' }>,
    ) => void;
  } = {},
): Promise<Message> {
  const frame = encodeMessage(message);
  if (Buffer.byteLength(frame) > limits.max_frame_bytes)
    throw new ProtocolError('frame_too_large');
  if (options.signal?.aborted) throw new ProtocolError('unavailable');
  const socket = createConnection(path);
  const abort = () => socket.destroy();
  options.signal?.addEventListener('abort', abort, { once: true });
  const response = receive(socket, limits, options.onProgress);
  socket.on('error', () => {});
  socket.on('connect', () => socket.write(frame));
  try {
    return await response;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    socket.destroy();
  }
}
