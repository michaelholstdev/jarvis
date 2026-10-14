import { chmodSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  type Diagnostic,
  encodeMessage,
  type Message,
  ProtocolError,
} from '../../packages/protocol/index.js';
import { configPath, loadConfig } from './config.js';
import { createCore } from './core.js';
import { runtimeDirectory } from './runtime.js';
import { receive, request } from './transport.js';

async function main() {
  const path = configPath();
  const config = loadConfig(
    existsSync(path) || process.env.JARVIS_CONFIG ? path : undefined,
  );
  const command = process.argv[2];
  if (command === 'config') {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  if (command !== 'start' && command !== 'health')
    throw new Error('usage: start | health | config');
  const directory = runtimeDirectory();
  const corePath = join(directory, 'core.sock');
  if (command === 'health') {
    const response = await request(corePath, 'cli', {
      ...config.transport,
      timeout_ms: config.transport.timeout_ms * 2,
    });
    if (response.type !== 'ready' || response.service !== 'core')
      throw new Error(
        response.type === 'error' ? response.code : 'invalid_message',
      );
    console.log(JSON.stringify(response.status));
    process.exitCode = response.status.ready ? 0 : 1;
    return;
  }
  const core = createCore({ now: () => performance.now() });
  const refresh = async () => {
    try {
      const response = await request(
        join(directory, 'audio.sock'),
        'core',
        config.transport,
      );
      if (response.type !== 'ready' || response.service !== 'audio')
        throw new ProtocolError(
          response.type === 'error' ? response.code : 'invalid_message',
        );
      core.dispatch({ type: 'audio-ready' });
      return undefined;
    } catch (error) {
      const diagnostic =
        error instanceof ProtocolError ? error.code : 'unavailable';
      core.dispatch({ type: 'audio-lost', diagnostic });
      return diagnostic;
    }
  };
  await refresh();
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    void (async () => {
      let response: Message;
      try {
        const message = await receive(socket, config.transport);
        if (message.type !== 'hello' || message.role !== 'cli')
          throw new ProtocolError('invalid_message');
        const diagnostic = await refresh();
        response = {
          version: 1,
          type: 'ready',
          service: 'core',
          status: core.status(),
        };
        if (diagnostic)
          console.error(
            JSON.stringify({ event: 'audio_unavailable', code: diagnostic }),
          );
      } catch (error) {
        response = {
          version: 1,
          type: 'error',
          code: error instanceof ProtocolError ? error.code : 'unavailable',
        };
      }
      socket.end(encodeMessage(response), () => socket.destroy());
    })();
  });
  server.maxConnections = config.transport.max_connections;
  server.on('error', () => {
    console.error(
      JSON.stringify({ event: 'error', code: 'socket_in_use_or_unavailable' }),
    );
    process.exitCode = 1;
  });
  server.listen(corePath, () => {
    chmodSync(corePath, 0o600);
    console.log(
      JSON.stringify({
        event: 'service_started',
        service: 'core',
        mode: 'mock',
      }),
    );
  });
  const stop = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((error: unknown) => {
  const known: Diagnostic[] = [
    'invalid_message',
    'incompatible_version',
    'frame_too_large',
    'timeout',
    'unavailable',
    'busy',
  ];
  const message = error instanceof Error ? error.message : '';
  const code =
    message.startsWith('invalid_config:') ||
    message.startsWith('usage:') ||
    known.includes(message as Diagnostic) ||
    [
      'unsafe_runtime_directory',
      'missing_runtime_directory',
      'runtime_path_too_long',
    ].includes(message)
      ? message
      : 'startup_failed';
  console.error(JSON.stringify({ event: 'error', code }));
  process.exitCode = 1;
});
