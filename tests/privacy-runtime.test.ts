import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from '../apps/core/transport.js';
import type { Message } from '../packages/protocol/index.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

test(
  'simulated desktop and hardware mute cross daemon/Python sockets independently',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-privacy-'));
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    delete (env as NodeJS.ProcessEnv).JARVIS_CONFIG;
    const children: ReturnType<typeof spawn>[] = [];
    let logs = '';
    const start = async (command: string, args: string[]) => {
      const child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      child.stdout.on('data', (chunk) => {
        logs += chunk;
      });
      child.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(() => {
          throw new Error('service startup failed');
        }),
      ]);
    };
    const limits = {
      timeout_ms: 6000,
      max_frame_bytes: 8192,
      max_connections: 8,
    };
    const send = (message?: Message) =>
      request(join(runtime, 'jarvis/core.sock'), 'cli', limits, message);
    const signal = async (
      source: 'locked' | 'muted' | 'hardware_muted',
      active: boolean,
    ) => {
      const result = await send({
        version: 1,
        type: 'inhibition-changed',
        source,
        active,
      });
      assert.ok(result.type === 'ready' && result.service === 'core');
      assert.equal(result.status.inhibitions[source], active);
      assert.equal(result.status.privacy_pending, false);
      return result.status;
    };
    try {
      await start('.venv/bin/python', ['apps/audio/main.py']);
      await start('node', ['dist/apps/core/main.js', 'start']);
      await send({ version: 1, type: 'demo', text: 'private privacy fixture' });
      assert.equal((await signal('muted', true)).state, 'idle');
      await signal('locked', true);
      assert.equal(
        (await signal('muted', false)).manual_activation,
        'unavailable',
      );
      assert.deepEqual(await send({ version: 1, type: 'activate' }), {
        version: 1,
        type: 'error',
        code: 'unavailable',
      });
      // Audio itself rejects capture, synthesis and playback under inhibition.
      for (const type of [
        'recognize',
        'synthesize',
        'play',
        'acknowledge',
      ] as const) {
        assert.deepEqual(
          await request(join(runtime, 'jarvis/audio.sock'), 'core', limits, {
            version: 1,
            type: 'audio-operation',
            operation: {
              type,
              operation_id: 'ambient',
              text: 'private ambient fixture',
            },
          }),
          { version: 1, type: 'error', code: 'unavailable' },
        );
      }
      await signal('hardware_muted', true);
      assert.equal(
        (await signal('locked', false)).manual_activation,
        'unavailable',
      );
      assert.equal(
        (await signal('hardware_muted', false)).manual_activation,
        'mock',
      );
      const resumed = await send();
      assert.ok(resumed.type === 'ready' && resumed.service === 'core');
      assert.equal(resumed.status.state, 'idle');
      assert.equal(
        (await send({ version: 1, type: 'activate' })).type,
        'ready',
      );
      assert.doesNotMatch(
        logs,
        /private privacy fixture|private ambient fixture|simulierte Antwort/,
      );
    } finally {
      for (const child of children.reverse()) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
      rmSync(runtime, { recursive: true });
    }
  },
);

test(
  'privacy interrupts pending playback; overlapping signals and late playback cannot resume it',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-race-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    delete env.JARVIS_CONFIG;
    const peers = new Set<Socket>();
    let playback: { socket: Socket; id: string } | undefined;
    let notifyPlayback = () => {};
    let notifyPrivacy = () => {};
    let finishPrivacy = () => {};
    let holdPrivacy = true;
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (frame) => {
        const message = parseMessage(frame);
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
        assert.equal(message.type, 'audio-operation');
        if (message.type !== 'audio-operation') return;
        const op = message.operation;
        const respond = () =>
          socket.end(
            encodeMessage({
              version: 1,
              type: 'audio-result',
              operation_id: op.operation_id,
              ...(op.type === 'recognize' ? { text: op.text } : {}),
              ...(op.type === 'acknowledge' || op.type === 'play'
                ? { completed: true, delivered_chars: op.text?.length ?? 0 }
                : {}),
            }),
          );
        if (op.type === 'play' && !playback) {
          playback = { socket, id: op.operation_id };
          notifyPlayback();
        } else if (op.type === 'privacy' && holdPrivacy) {
          holdPrivacy = false;
          finishPrivacy = respond;
          notifyPrivacy();
        } else respond();
      });
    });
    const core = spawn('node', ['dist/apps/core/main.js', 'start'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    core.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    core.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const limits = {
      timeout_ms: 6000,
      max_frame_bytes: 8192,
      max_connections: 8,
    };
    const send = (message?: Message) =>
      request(join(runtime, 'jarvis/core.sock'), 'cli', limits, message);
    try {
      await once(core.stdout, 'data');
      audio.listen(join(runtime, 'jarvis/audio.sock'));
      await once(audio, 'listening');
      const played = new Promise<void>((resolve) => {
        notifyPlayback = resolve;
      });
      const oldTurn = send({
        version: 1,
        type: 'demo',
        text: 'private delayed fixture',
      });
      await played;
      const cleaning = new Promise<void>((resolve) => {
        notifyPrivacy = resolve;
      });
      const mute = send({
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: true,
      });
      await cleaning;
      const lock = send({
        version: 1,
        type: 'inhibition-changed',
        source: 'locked',
        active: true,
      });
      const activate = send({ version: 1, type: 'activate' });
      finishPrivacy();
      await Promise.all([mute, lock]);
      assert.deepEqual(await activate, {
        version: 1,
        type: 'error',
        code: 'unavailable',
      });
      await send({
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: false,
      });
      const release = await send({
        version: 1,
        type: 'inhibition-changed',
        source: 'locked',
        active: false,
      });
      assert.ok(release.type === 'ready' && release.service === 'core');
      assert.equal(release.status.manual_activation, 'mock');
      assert.equal(release.status.state, 'idle');
      assert.ok(playback);
      // A fresh conversation need not wait for the canceled transport to finish.
      const fresh = await send({
        version: 1,
        type: 'demo',
        text: 'Neue Frage',
      });
      assert.ok(fresh.type === 'ready' && fresh.service === 'core');
      assert.equal(fresh.status.state, 'follow-up');
      playback.socket.end(
        encodeMessage({
          version: 1,
          type: 'audio-result',
          operation_id: playback.id,
          completed: true,
          delivered_chars: 42,
        }),
      );
      await oldTurn;
      const status = await send();
      assert.ok(status.type === 'ready' && status.service === 'core');
      assert.equal(status.status.state, 'follow-up');
      assert.doesNotMatch(logs, /private delayed fixture|simulierte Antwort/);
    } finally {
      core.kill('SIGTERM');
      await once(core, 'exit');
      for (const peer of peers) peer.destroy();
      await new Promise<void>((resolve) => audio.close(() => resolve()));
      rmSync(runtime, { recursive: true });
    }
  },
);

for (const [command, source] of [
  ['demo', 'muted'],
  ['activate', 'locked'],
  ['stop', 'hardware_muted'],
] as const) {
  for (const failedHandshake of [false, true]) {
    test(
      `pending ${command} is canceled by ${source}; stale handshake failure=${failedHandshake}`,
      { timeout: 10000 },
      async () => {
        const runtime = mkdtempSync(join(tmpdir(), 'jv-wait-'));
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          XDG_RUNTIME_DIR: runtime,
          XDG_CONFIG_HOME: join(runtime, 'config'),
        };
        delete env.JARVIS_CONFIG;
        const peers = new Set<Socket>();
        let holdHandshake = false;
        let releaseHandshake = () => {};
        let notifyHandshake = () => {};
        const recognized: string[] = [];
        const audio = createServer((socket) => {
          peers.add(socket);
          socket.on('close', () => peers.delete(socket));
          socket.on('error', () => {});
          socket.on('data', (frame) => {
            const message = parseMessage(frame);
            if (message.type === 'hello') {
              const respond = () =>
                socket.end(
                  encodeMessage({
                    version: 1,
                    type: 'ready',
                    service: 'audio',
                    mode: 'mock',
                  }),
                );
              if (holdHandshake) {
                holdHandshake = false;
                releaseHandshake = failedHandshake
                  ? () =>
                      socket.end(
                        encodeMessage({
                          version: 1,
                          type: 'error',
                          code: 'invalid_message',
                        }),
                      )
                  : respond;
                notifyHandshake();
              } else respond();
              return;
            }
            assert.ok(message.type === 'audio-operation');
            const op = message.operation;
            if (op.type === 'recognize') recognized.push(op.text ?? '');
            socket.end(
              encodeMessage({
                version: 1,
                type: 'audio-result',
                operation_id: op.operation_id,
                ...(op.type === 'recognize' ? { text: op.text } : {}),
                ...(['play', 'acknowledge'].includes(op.type)
                  ? { completed: true, delivered_chars: op.text?.length ?? 0 }
                  : {}),
              }),
            );
          });
        });
        const core = spawn('node', ['dist/apps/core/main.js', 'start'], {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const limits = {
          timeout_ms: 6000,
          max_frame_bytes: 8192,
          max_connections: 8,
        };
        const send = (message?: Message) =>
          request(join(runtime, 'jarvis/core.sock'), 'cli', limits, message);
        try {
          await once(core.stdout, 'data');
          audio.listen(join(runtime, 'jarvis/audio.sock'));
          await once(audio, 'listening');
          holdHandshake = true;
          const waiting = new Promise<void>((resolve) => {
            notifyHandshake = resolve;
          });
          const oldRequest = send(
            command === 'demo'
              ? { version: 1, type: 'demo', text: 'Pre-mute question' }
              : { version: 1, type: command },
          );
          await waiting;
          for (const active of [true, false]) {
            const signal = await send({
              version: 1,
              type: 'inhibition-changed',
              source,
              active,
            });
            assert.ok(signal.type === 'ready' && signal.service === 'core');
            assert.equal(signal.status.privacy_pending, false);
          }
          assert.deepEqual(recognized, []);
          const fresh = await send({
            version: 1,
            type: 'demo',
            text: 'Fresh question',
          });
          assert.ok(fresh.type === 'ready' && fresh.service === 'core');
          assert.equal(fresh.status.state, 'follow-up');
          releaseHandshake();
          assert.deepEqual(await oldRequest, {
            version: 1,
            type: 'error',
            code: 'unavailable',
          });
          const status = await send();
          assert.ok(status.type === 'ready' && status.service === 'core');
          assert.equal(status.status.state, 'follow-up');
          assert.equal(status.status.ready, true);
          assert.deepEqual(recognized, ['Fresh question']);
        } finally {
          core.kill('SIGTERM');
          await once(core, 'exit');
          for (const peer of peers) peer.destroy();
          await new Promise<void>((resolve) => audio.close(() => resolve()));
          rmSync(runtime, { recursive: true });
        }
      },
    );
  }
}
