import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { request } from '../apps/core/transport.js';
import { encodeMessage, type Message } from '../packages/protocol/index.js';

for (const failure of ['disconnect', 'timeout', 'service-error'] as const) {
  test(
    `daemon recovers ${failure} without replay and accepts explicit retry over real sockets`,
    { timeout: 10000 },
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), 'jv-rec-'));
      mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
      const configPath = join(runtime, 'config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          transport: { timeout_ms: 300 },
          recovery: { probe_interval_ms: 500 },
        }),
      );
      const peers = new Set<Socket>();
      let fail = true;
      let synthesisCount = 0;
      let cues = 0;
      let connections = 0;
      const audio = createServer((socket) => {
        connections++;
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.on('error', () => {});
        socket.on('data', (frame) => {
          const message = JSON.parse(frame.toString());
          if (message.type === 'hello') {
            socket.end(
              encodeMessage({
                version: 1,
                type: 'ready',
                service: 'audio',
                mode: 'mock',
                capabilities: { wake: 'unavailable', stt: 'mock', tts: 'mock' },
              }),
            );
            return;
          }
          const op = message.operation;
          if (op.type === 'synthesize') {
            synthesisCount++;
            if (fail) {
              fail = false;
              if (failure === 'disconnect') socket.destroy();
              else if (failure === 'service-error')
                socket.end(
                  encodeMessage({
                    version: 1,
                    type: 'error',
                    code: 'unavailable',
                  }),
                );
              return;
            }
          }
          if (op.type === 'indicate-failure') cues++;
          socket.end(
            encodeMessage({
              version: 1,
              type: 'audio-result',
              operation_id: op.operation_id,
              ...(op.type === 'recognize' ? { text: op.text } : {}),
              ...([
                'play',
                'acknowledge',
                'cancel',
                'close-conversation',
                'indicate-failure',
              ].includes(op.type)
                ? {
                    completed: op.type !== 'cancel',
                    delivered_chars: op.type === 'play' ? op.text.length : 0,
                  }
                : {}),
            }),
          );
        });
      });
      audio.listen(join(runtime, 'jarvis/audio.sock'));
      await once(audio, 'listening');
      const core = spawn('node', ['dist/apps/core/main.js', 'start'], {
        env: {
          ...process.env,
          XDG_RUNTIME_DIR: runtime,
          JARVIS_CONFIG: configPath,
        },
      });
      let logs = '';
      core.stdout.on('data', (chunk) => {
        logs += chunk;
      });
      core.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      const send = (message?: Message) =>
        request(
          join(runtime, 'jarvis/core.sock'),
          'cli',
          { timeout_ms: 3000, max_frame_bytes: 8192, max_connections: 8 },
          message,
        );
      const status = async () => {
        const response = await send();
        assert.ok(response.type === 'ready' && response.service === 'core');
        return response.status;
      };
      try {
        await once(core.stdout, 'data');
        await send({
          version: 1,
          type: 'demo',
          text: 'private recovery fixture',
        });
        // Allow autonomous probes without issuing health/activation requests.
        await setTimeout(1100);
        if (failure !== 'service-error') assert.match(logs, /audio_recovered/);
        const recovered = await status();
        assert.equal(recovered.retry_available, true);
        assert.equal(recovered.state, 'follow-up');
        assert.equal(recovered.ready, true);
        assert.equal(synthesisCount, 1);
        assert.ok(connections < 20, 'recovery must not busy-loop');
        assert.equal(cues, failure === 'service-error' ? 1 : 0);
        await send({ version: 1, type: 'demo', text: 'Noch einmal' });
        assert.equal(synthesisCount, 2);
        assert.equal((await status()).retry_available, false);
        assert.doesNotMatch(
          logs,
          /private recovery fixture|simulierte Antwort|Noch einmal/,
        );
      } finally {
        core.kill('SIGTERM');
        await once(core, 'exit');
        for (const socket of peers) socket.destroy();
        await new Promise<void>((resolve) => audio.close(() => resolve()));
        rmSync(runtime, { recursive: true });
      }
    },
  );
}

test(
  'privacy service errors do not busy-loop and routine diagnostic floods stay bounded',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-bound-'));
    mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
    const peers = new Set<Socket>();
    let privacyRequests = 0;
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (frame) => {
        const message = JSON.parse(frame.toString());
        if (message.type === 'hello') {
          socket.end(
            encodeMessage({
              version: 1,
              type: 'ready',
              service: 'audio',
              mode: 'mock',
            }),
          );
          return;
        }
        const op = message.operation;
        if (op.type === 'privacy') {
          privacyRequests++;
          socket.end(
            encodeMessage({ version: 1, type: 'error', code: 'unavailable' }),
          );
          return;
        }
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize' ? { text: op.text } : {}),
            ...(['play', 'acknowledge', 'close-conversation'].includes(op.type)
              ? {
                  completed: true,
                  delivered_chars: op.type === 'play' ? op.text.length : 0,
                }
              : {}),
          }),
        );
      });
    });
    audio.listen(join(runtime, 'jarvis/audio.sock'));
    await once(audio, 'listening');
    const configPath = join(runtime, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ recovery: { probe_interval_ms: 30000 } }),
    );
    const core = spawn('node', ['dist/apps/core/main.js', 'start'], {
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: runtime,
        JARVIS_CONFIG: configPath,
      },
    });
    let logs = '';
    core.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    core.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const send = (message: Message) =>
      request(
        join(runtime, 'jarvis/core.sock'),
        'cli',
        { timeout_ms: 3000, max_frame_bytes: 8192, max_connections: 8 },
        message,
      );
    try {
      await once(core.stdout, 'data');
      for (let count = 0; count < 30; count++) {
        const response = await send({
          version: 1,
          type: 'demo',
          text: 'private flood fixture',
        });
        assert.ok(response.type === 'ready' && response.service === 'core');
        assert.equal(response.status.state, 'follow-up');
      }
      const response = await send({
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: true,
      });
      assert.deepEqual(response, {
        version: 1,
        type: 'error',
        code: 'unavailable',
      });
      await setTimeout(150);
      assert.equal(privacyRequests, 1);
      assert.ok(logs.trim().split('\n').length <= 101);
      assert.doesNotMatch(logs, /private flood fixture|simulierte Antwort/);
    } finally {
      core.kill('SIGTERM');
      await once(core, 'exit');
      for (const socket of peers) socket.destroy();
      await new Promise<void>((resolve) => audio.close(() => resolve()));
      rmSync(runtime, { recursive: true });
    }
  },
);

test(
  'responsive hello cannot bypass stalled cleanup or replay disconnected playback',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-clean-'));
    mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
    const configPath = join(runtime, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        transport: { timeout_ms: 300 },
        recovery: { probe_interval_ms: 30000 },
      }),
    );
    const peers = new Set<Socket>();
    let releaseCleanup = false;
    let plays = 0;
    let recognitions = 0;
    let cleanups = 0;
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (frame) => {
        const message = JSON.parse(frame.toString());
        if (message.type === 'hello') {
          socket.end(
            encodeMessage({
              version: 1,
              type: 'ready',
              service: 'audio',
              mode: 'mock',
            }),
          );
          return;
        }
        const op = message.operation;
        if (op.type === 'play') {
          plays++;
          socket.destroy();
          return;
        }
        if (op.type === 'recognize') recognitions++;
        if (op.type === 'privacy') {
          cleanups++;
          if (!releaseCleanup) return;
        }
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize' ? { text: op.text } : {}),
            ...(op.type === 'acknowledge'
              ? { completed: true, delivered_chars: 0 }
              : {}),
          }),
        );
      });
    });
    audio.listen(join(runtime, 'jarvis/audio.sock'));
    await once(audio, 'listening');
    const core = spawn('node', ['dist/apps/core/main.js', 'start'], {
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: runtime,
        JARVIS_CONFIG: configPath,
      },
    });
    let logs = '';
    core.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    core.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const send = (message?: Message) =>
      request(
        join(runtime, 'jarvis/core.sock'),
        'cli',
        { timeout_ms: 3000, max_frame_bytes: 8192, max_connections: 8 },
        message,
      );
    try {
      await once(core.stdout, 'data');
      assert.equal(
        (
          await send({
            version: 1,
            type: 'demo',
            text: 'private cleanup fixture',
          })
        ).type,
        'error',
      );
      const blocked = await send({ version: 1, type: 'activate' });
      assert.equal(blocked.type, 'error');
      assert.equal(plays, 1);
      assert.equal(recognitions, 1);
      assert.equal(cleanups, 1);
      releaseCleanup = true;
      const recovered = await send();
      assert.ok(recovered.type === 'ready' && recovered.service === 'core');
      assert.equal(recovered.status.ready, true);
      assert.equal(recovered.status.audio_cleanup_pending, false);
      assert.equal(recovered.status.retry_available, true);
      assert.equal(recovered.status.state, 'follow-up');
      assert.equal(plays, 1);
      assert.equal(recognitions, 1);
      assert.equal(cleanups, 2);
      assert.doesNotMatch(logs, /private cleanup fixture|simulierte Antwort/);
    } finally {
      core.kill('SIGTERM');
      await once(core, 'exit');
      for (const socket of peers) socket.destroy();
      await new Promise<void>((resolve) => audio.close(() => resolve()));
      rmSync(runtime, { recursive: true });
    }
  },
);
