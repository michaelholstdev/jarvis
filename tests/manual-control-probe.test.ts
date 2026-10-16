import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from '../apps/core/transport.js';
import { encodeMessage, type Message } from '../packages/protocol/index.js';

for (const [control, state] of [
  ['stop', 'speaking'],
  ['activate', 'speaking'],
  ['activate', 'thinking'],
] as const) {
  test(
    `${control} cancels ${state} while an inference health probe is still pending`,
    { timeout: 10000 },
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), 'jv-control-'));
      mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
      const events = new EventEmitter();
      let holdProbe = false;
      let releaseProbe = () => {};
      const ollama = createHttpServer((req, res) => {
        if (req.url === '/api/tags') {
          const respond = () =>
            res.end('{"models":[{"name":"fixture:local"}]}');
          if (holdProbe) {
            releaseProbe = respond;
            events.emit('probe');
          } else respond();
          return;
        }
        req.resume();
        req.on('end', () => {
          if (state === 'thinking') {
            res.write('{"message":{"content":"Eine Antwort"},"done":false}\n');
            events.emit('work');
          } else
            res.end('{"message":{"content":"Eine Antwort"},"done":true}\n');
        });
      });
      ollama.listen(0, '127.0.0.1');
      await once(ollama, 'listening');
      const address = ollama.address();
      assert.ok(address && typeof address !== 'string');
      const configPath = join(runtime, 'config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          audio: { mode: 'voice' },
          llm: {
            mode: 'ollama',
            model: 'fixture:local',
            base_url: `http://127.0.0.1:${address.port}`,
          },
          transport: { timeout_ms: 5000 },
          recovery: { probe_interval_ms: 30000 },
        }),
      );
      let canceled = false;
      const peers = new Set<Socket>();
      const audio = createServer((socket) => {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.on('error', () => {});
        socket.once('data', (frame) => {
          const message = JSON.parse(frame.toString());
          if (message.type === 'hello') {
            socket.end(
              encodeMessage({
                version: 1,
                type: 'ready',
                service: 'audio',
                mode: 'voice',
                capabilities: { stt: 'ready', tts: 'ready' },
              }),
            );
            return;
          }
          const op = message.operation;
          if (op.type === 'play') {
            events.emit('work');
            return;
          }
          if (op.type === 'cancel') {
            canceled = true;
            events.emit('cancel');
          }
          socket.end(
            encodeMessage({
              version: 1,
              type: 'audio-result',
              operation_id: op.operation_id,
              ...(op.type === 'recognize'
                ? { text: canceled ? 'Gespräch beenden' : 'Eine Frage' }
                : {}),
              ...(['acknowledge', 'cancel', 'close-conversation'].includes(
                op.type,
              )
                ? { completed: op.type !== 'cancel', delivered_chars: 0 }
                : {}),
            }),
          );
        });
      });
      audio.listen(join(runtime, 'jarvis/audio.sock'));
      await once(audio, 'listening');
      const daemon = spawn('node', ['dist/apps/core/main.js', 'start'], {
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: runtime,
          JARVIS_CONFIG: configPath,
        },
      });
      daemon.stderr.resume();
      const send = (message?: Message) =>
        request(
          join(runtime, 'jarvis/core.sock'),
          'cli',
          { timeout_ms: 6000, max_frame_bytes: 8192, max_connections: 8 },
          message,
        );
      const pending: Promise<unknown>[] = [];
      try {
        await once(daemon.stdout, 'data');
        daemon.stdout.resume();
        const working = once(events, 'work');
        await send({ version: 1, type: 'activate' });
        await working;
        holdProbe = true;
        const probing = once(events, 'probe');
        const health = send();
        pending.push(health);
        void health.catch(() => {});
        await probing;
        // The fake probe stays unresolved until after we observe cancellation.
        // Its 5-second timeout is deliberately longer than this regression deadline.
        const cancellation = once(events, 'cancel', {
          signal: AbortSignal.timeout(1000),
        });
        const action = send({ version: 1, type: control });
        pending.push(action);
        void action.catch(() => {});
        await cancellation;
        releaseProbe();
        const response = await action;
        assert.ok(response.type === 'ready' && response.service === 'core');
        await health;
      } finally {
        releaseProbe();
        daemon.kill('SIGTERM');
        await once(daemon, 'exit');
        await Promise.allSettled(pending);
        for (const socket of peers) socket.destroy();
        ollama.closeAllConnections();
        await Promise.all([
          new Promise<void>((resolve) => audio.close(() => resolve())),
          new Promise<void>((resolve) => ollama.close(() => resolve())),
        ]);
        rmSync(runtime, { recursive: true });
      }
    },
  );
}
