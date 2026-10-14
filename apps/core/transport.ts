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
): Promise<Message> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
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
      if (data.length + chunk.length > limits.max_frame_bytes)
        return finish(new ProtocolError('frame_too_large'));
      data = Buffer.concat([data, chunk]);
      const newline = data.indexOf(10);
      if (newline < 0) return;
      try {
        finish(undefined, parseMessage(data.subarray(0, newline)));
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
): Promise<Message> {
  const socket = createConnection(path);
  const response = receive(socket, limits);
  socket.on('error', () => {});
  socket.on('connect', () => socket.write(encodeMessage(message)));
  try {
    return await response;
  } finally {
    socket.destroy();
  }
}
