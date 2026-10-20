import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

test('wake socket preserves the immediate question and rejects canceled detections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jv-wake-'));
  const config = loadConfig();
  config.audio.mode = 'voice';
  const core = createCore({ now: () => 0 }, config);
  core.dispatch({
    type: 'audio-ready',
    capabilities: { wake: 'ready', stt: 'ready', tts: 'ready' },
  });
  const operations: string[] = [];
  const peers = new Set<Socket>();
  let wakeSocket: Socket | undefined;
  let wakeId = '';
  let arrived = () => {};
  let waiting = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const server = createServer((socket) => {
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (frame) => {
      const message = parseMessage(frame);
      assert.ok(message.type === 'audio-operation');
      const op = message.operation;
      operations.push(op.type);
      if (op.type === 'wake') {
        wakeSocket = socket;
        wakeId = op.operation_id;
        arrived();
        return;
      }
      socket.end(
        encodeMessage({
          version: 1,
          type: 'audio-result',
          operation_id: op.operation_id,
          ...(op.type === 'recognize' ? { text: '' } : {}),
          ...(['cancel', 'privacy', 'acknowledge', 'play'].includes(op.type)
            ? {
                completed: op.type !== 'cancel',
                delivered_chars: op.text?.length ?? 0,
              }
            : {}),
        }),
      );
    });
  });
  server.listen(join(directory, 'audio.sock'));
  await once(server, 'listening');
  try {
    const first = runTurn(core, join(directory, 'audio.sock'), config);
    await waiting;
    assert.deepEqual(
      operations,
      ['wake'],
      'ambient audio never invokes STT or LLM',
    );
    wakeSocket?.write(
      encodeMessage({
        version: 1,
        type: 'speech-started',
        operation_id: wakeId,
      }),
    );
    wakeSocket?.end(
      encodeMessage({
        version: 1,
        type: 'audio-result',
        operation_id: wakeId,
        text: 'Wie spät ist es?',
      }),
    );
    await first;
    assert.deepEqual(
      operations,
      ['wake', 'synthesize', 'play'],
      'no cue or capture restart between detection and question',
    );
    assert.equal(core.status().state, 'follow-up');
    core.dispatch({
      type: 'inhibition-changed',
      source: 'locked',
      active: true,
    });
    await runTurn(core, join(directory, 'audio.sock'), config);
    core.dispatch({
      type: 'inhibition-changed',
      source: 'muted',
      active: true,
    });
    await runTurn(core, join(directory, 'audio.sock'), config);
    core.dispatch({
      type: 'inhibition-changed',
      source: 'locked',
      active: false,
    });
    await runTurn(core, join(directory, 'audio.sock'), config);
    assert.deepEqual(core.operations(), []);
    core.dispatch({
      type: 'inhibition-changed',
      source: 'muted',
      active: false,
    });
    // Apply privacy separately; runTurn then arms a fresh wake operation.
    const barrier = core.operations()[0];
    assert.equal(barrier?.type, 'privacy');
    core.dispatch({
      type: 'privacy-applied',
      operation_id: barrier.operation_id,
    });
    waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const pending = runTurn(core, join(directory, 'audio.sock'), config);
    await waiting;
    const staleId = wakeId;
    core.activate();
    await pending;
    assert.equal(core.operations()[0]?.type, 'cancel');
    core.dispatch({ type: 'speech-started', operation_id: staleId });
    core.dispatch({
      type: 'recognized',
      operation_id: staleId,
      text: 'Veraltete Frage',
    });
    assert.equal(core.status().state, 'cancelling');
    config.wake_word.enabled = false;
    await runTurn(core, join(directory, 'audio.sock'), config);
    assert.equal(core.status().state, 'idle');
    core.dispatch({ type: 'audio-lost' });
    core.dispatch({ type: 'audio-ready', capabilities: { wake: 'ready' } });
    const cleanup = core.operations()[0];
    if (cleanup?.type === 'privacy')
      core.dispatch({
        type: 'privacy-applied',
        operation_id: cleanup.operation_id,
      });
    assert.equal(
      core.operations().some((op) => op.type === 'wake'),
      false,
    );
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});

// Exercise the actual daemon ticker, probes and shutdown, with the audio service
// as the external protocol boundary. PCM/model behavior has separate socket tests.
for (const setup of ['voice', 'disabled', 'mock'] as const) {
  test(
    `daemon wake lifecycle with ${setup} configuration`,
    { timeout: 10000 },
    async () => {
      const { spawn } = await import('node:child_process');
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { request } = await import('../apps/core/transport.js');
      const { setTimeout: delay } = await import('node:timers/promises');
      const directory = mkdtempSync(join(tmpdir(), 'jv-waked-'));
      mkdirSync(join(directory, 'jarvis'), { mode: 0o700 });
      const configPath = join(directory, 'config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          audio: { mode: setup === 'mock' ? 'mock' : 'voice' },
          wake_word: setup === 'disabled' ? { enabled: false } : {},
          recovery: { probe_interval_ms: 500 },
        }),
      );
      const peers = new Set<Socket>();
      const wakes: { id: string; socket: Socket }[] = [];
      const operations: string[] = [];
      let available = true;
      const audio = createServer((socket) => {
        peers.add(socket);
        socket.on('close', () => peers.delete(socket));
        socket.on('error', () => {});
        socket.once('data', (frame) => {
          if (!available) {
            socket.destroy();
            return;
          }
          const message = parseMessage(frame);
          if (message.type === 'hello') {
            socket.end(
              encodeMessage({
                version: 1,
                type: 'ready',
                service: 'audio',
                mode: setup === 'mock' ? 'mock' : 'voice',
                capabilities: { wake: 'ready', stt: 'ready', tts: 'ready' },
              }),
            );
          } else {
            assert.ok(message.type === 'audio-operation');
            const op = message.operation;
            operations.push(op.type);
            if (op.type === 'wake') {
              wakes.push({ id: op.operation_id, socket });
              return;
            }
            socket.end(
              encodeMessage({
                version: 1,
                type: 'audio-result',
                operation_id: op.operation_id,
                ...([
                  'play',
                  'privacy',
                  'cancel',
                  'close-conversation',
                ].includes(op.type)
                  ? { completed: true, delivered_chars: op.text?.length ?? 0 }
                  : {}),
              }),
            );
          }
        });
      });
      audio.listen(join(directory, 'jarvis/audio.sock'));
      await once(audio, 'listening');
      const daemon = spawn(
        process.execPath,
        ['dist/apps/core/main.js', 'start'],
        {
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: directory,
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
      const send = (
        message?: import('../packages/protocol/index.js').Message,
      ) =>
        request(
          join(directory, 'jarvis/core.sock'),
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
        for (let i = 0; i < 200; i++) {
          if (await predicate()) return;
          await delay(10);
        }
        assert.fail(logs);
      };
      try {
        await until(() => logs.includes('service_started'));
        assert.equal((await health()).wake_word.enabled, setup !== 'disabled');
        if (setup !== 'voice') {
          await delay(250);
          assert.deepEqual(operations, []);
          assert.equal((await health()).wake_word.ready, false);
          return;
        }
        await until(() => wakes.length === 1);
        assert.equal((await health()).wake_word.quality, 'experimental');
        const first = wakes[0];
        assert.ok(first);
        first.socket.write(
          encodeMessage({
            version: 1,
            type: 'speech-started',
            operation_id: first.id,
          }),
        );
        first.socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: first.id,
            text: 'private immediate question',
          }),
        );
        await until(async () => (await health()).state === 'follow-up');
        assert.deepEqual(operations, ['wake', 'synthesize', 'play']);
        await send({
          version: 1,
          type: 'inhibition-changed',
          source: 'muted',
          active: true,
        });
        assert.equal((await health()).wake_word.ready, false);
        await send({
          version: 1,
          type: 'inhibition-changed',
          source: 'muted',
          active: false,
        });
        await until(() => wakes.length === 2);
        available = false;
        for (const peer of peers) peer.destroy();
        await until(async () => !(await health()).ready);
        available = true;
        await until(() => wakes.length === 3);
        assert.equal(
          operations.filter((op) => op === 'play').length,
          1,
          'recovery does not replay a question or answer',
        );
        assert.equal((await health()).state, 'idle');
        assert.ok(!logs.includes('private immediate question'));
      } finally {
        daemon.kill('SIGTERM');
        await once(daemon, 'exit');
        for (const peer of peers) peer.destroy();
        await new Promise<void>((resolve) => audio.close(() => resolve()));
        rmSync(directory, { recursive: true });
      }
    },
  );
}
