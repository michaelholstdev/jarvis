import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { request } from '../apps/core/transport.js';
import { encodeMessage, type Message } from '../packages/protocol/index.js';

test(
  'audio restart restores voice readiness without capture until explicit activation',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-audio-restart-'));
    mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
    const ollama = createHttpServer((req, res) => {
      req.resume();
      res.end(
        req.url === '/api/tags'
          ? '{"models":[{"name":"test:local"}]}'
          : '{"message":{"content":"Eine kurze Antwort."},"done":true}\n',
      );
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
        interaction: { activation_sound: false },
        llm: {
          mode: 'ollama',
          base_url: `http://127.0.0.1:${address.port}`,
          model: 'test:local',
        },
        transport: { timeout_ms: 300 },
        recovery: { probe_interval_ms: 500 },
      }),
    );
    const peers = new Set<Socket>();
    let available = true;
    let recognitions = 0;
    let plays = 0;
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (frame) => {
        if (!available) {
          socket.destroy();
          return;
        }
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
        if (op.type === 'recognize') {
          recognitions++;
          if (recognitions > 1) return;
        }
        if (op.type === 'play') {
          plays++;
          return; // Playback is interrupted by the simulated service crash.
        }
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize' ? { text: 'Eine Testfrage.' } : {}),
            ...(['cancel', 'close-conversation', 'indicate-failure'].includes(
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
    const daemon = spawn(
      process.execPath,
      ['dist/apps/core/main.js', 'start'],
      {
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: runtime,
          JARVIS_CONFIG: configPath,
        },
      },
    );
    let logs = '';
    daemon.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    daemon.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const send = (message?: Message) =>
      request(
        join(runtime, 'jarvis/core.sock'),
        'cli',
        { timeout_ms: 2000, max_frame_bytes: 8192, max_connections: 8 },
        message,
      );
    const health = async () => {
      const result = await send();
      assert.ok(result.type === 'ready' && result.service === 'core');
      return result.status;
    };
    const until = async (predicate: () => boolean | Promise<boolean>) => {
      for (let count = 0; count < 300; count++) {
        if (await predicate()) return;
        await setTimeout(10);
      }
      assert.fail(`Timed out waiting for service state: ${logs}`);
    };
    try {
      await once(daemon.stdout, 'data');
      await until(async () => (await health()).voice_conversation === 'ready');
      const activation = send({ version: 1, type: 'activate' }).catch(() => {});
      await until(() => plays === 1);
      available = false;
      for (const socket of peers) socket.destroy();
      await until(async () => !(await health()).ready);
      await activation;
      available = true;
      // Several autonomous probes and tickers run before another user action.
      await setTimeout(1100);
      assert.equal(
        recognitions,
        1,
        'recovery must not reopen microphone capture',
      );
      assert.equal(plays, 1, 'recovery must not replay the interrupted answer');
      for (const recovered of await Promise.all([
        health(),
        health(),
        health(),
      ])) {
        assert.equal(recovered.voice_conversation, 'ready');
        assert.equal(recovered.state, 'follow-up');
        assert.equal(recovered.retry_available, true);
      }
      assert.equal(recognitions, 1, 'health probes cannot authorize capture');
      const explicitActivation = send({
        version: 1,
        type: 'activate',
      }).catch(() => {});
      await until(() => recognitions > 1);
      assert.equal(
        recognitions,
        2,
        'a deliberate activation starts one capture',
      );
      await send({
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: true,
      });
      await explicitActivation;
    } catch (error) {
      assert.fail(`${String(error)}\n${logs}`);
    } finally {
      daemon.kill('SIGTERM');
      await once(daemon, 'exit');
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
