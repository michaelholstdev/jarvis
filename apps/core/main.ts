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
import { runMockTurn } from './mock-turn.js';
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
  if (!['start', 'health', 'activate', 'demo'].includes(command ?? ''))
    throw new Error(
      'usage: start | health | config | activate | demo [utterance]',
    );
  const directory = runtimeDirectory();
  const corePath = join(directory, 'core.sock');
  if (command !== 'start') {
    const response = await request(
      corePath,
      'cli',
      {
        ...config.transport,
        timeout_ms:
          config.transport.timeout_ms * (command === 'health' ? 2 : 6),
      },
      command === 'activate'
        ? { version: 1, type: 'activate' }
        : command === 'demo'
          ? {
              version: 1,
              type: 'demo',
              text: process.argv[3] ?? 'Wie geht es dir?',
            }
          : undefined,
    );
    if (response.type !== 'ready' || response.service !== 'core')
      throw new Error(
        response.type === 'error' ? response.code : 'invalid_message',
      );
    console.log(JSON.stringify(response.status));
    process.exitCode = response.status.ready ? 0 : 1;
    return;
  }
  const core = createCore({ now: () => performance.now() }, config);
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
  let runningTurn = false;
  const ticker = setInterval(() => {
    const before = core.status();
    core.dispatch({ type: 'tick' });
    if (before.state !== core.status().state)
      console.error(
        JSON.stringify({
          event: 'turn_expired',
          code: 'timeout',
          state: core.status().state,
          elapsed_ms: before.since_ms,
        }),
      );
  }, 100);
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    void (async () => {
      let response: Message;
      try {
        const message = await receive(socket, config.transport);
        if (
          !(
            (message.type === 'hello' && message.role === 'cli') ||
            message.type === 'activate' ||
            message.type === 'demo'
          )
        )
          throw new ProtocolError('invalid_message');
        if (message.type === 'activate' || message.type === 'demo') {
          if (runningTurn) throw new ProtocolError('busy');
          runningTurn = true;
          try {
            const diagnostic = await refresh();
            if (diagnostic) throw new ProtocolError(diagnostic);
            if (message.type === 'activate' || core.status().state === 'idle')
              core.activate();
            if (
              message.type === 'demo' &&
              !['listening', 'acknowledging'].includes(core.status().state)
            )
              throw new ProtocolError('busy');
            try {
              await runMockTurn(
                core,
                join(directory, 'audio.sock'),
                config,
                message.type === 'demo' ? message.text : undefined,
              );
            } catch (error) {
              core.dispatch({
                type: 'audio-lost',
                diagnostic:
                  error instanceof ProtocolError ? error.code : 'unavailable',
              });
              throw error;
            }
            if (message.type === 'demo' && !core.reply())
              throw new ProtocolError('invalid_message');
          } finally {
            runningTurn = false;
          }
        }
        const diagnostic =
          message.type === 'hello' ? await refresh() : undefined;
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
    clearInterval(ticker);
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
    clearInterval(ticker);
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
