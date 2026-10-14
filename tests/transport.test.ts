import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from '../apps/core/transport.js';

test(
  'CLI reports ready only after a real Python audio handshake',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    delete env.JARVIS_CONFIG;
    let routineLogs = '';
    const children: ReturnType<typeof spawn>[] = [];
    const start = async (command: string, args: string[]) => {
      const child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      child.stdout.on('data', (chunk) => {
        routineLogs += chunk;
      });
      child.stderr.on('data', (chunk) => {
        routineLogs += chunk;
      });
      let diagnostic = '';
      child.stderr.on('data', (chunk) => {
        diagnostic += chunk;
      });
      const result = await Promise.race([
        once(child.stdout, 'data').then(([chunk]) => chunk.toString()),
        once(child, 'exit').then(([code]) => {
          throw new Error(`service exited: ${code}: ${diagnostic}`);
        }),
      ]);
      assert.match(result, /service_started/);
      return child;
    };
    try {
      const audio = await start('.venv/bin/python', ['apps/audio/main.py']);
      await start('node', ['dist/apps/core/main.js', 'start']);
      const cli = spawn('node', ['dist/apps/core/main.js', 'health'], { env });
      let output = '';
      cli.stdout.on('data', (chunk) => {
        output += chunk;
      });
      const [code] = await once(cli, 'exit');
      assert.equal(code, 0);
      assert.equal(JSON.parse(output).ready, true);
      assert.equal(JSON.parse(output).voice_conversation, 'unavailable');
      for (const name of ['audio', 'core']) {
        assert.equal(
          statSync(join(runtime, 'jarvis', `${name}.sock`)).mode & 0o777,
          0o600,
        );
      }
      const runCli = async (args: string[]) => {
        const child = spawn('node', ['dist/apps/core/main.js', ...args], {
          env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const [exit] = await once(child, 'exit');
        assert.equal(exit, 0, stderr);
        assert.doesNotMatch(stdout + stderr, /private fixture/);
        return JSON.parse(stdout);
      };
      assert.equal((await runCli(['activate'])).state, 'listening');
      assert.equal(
        (await runCli(['demo', 'private fixture'])).state,
        'follow-up',
      );
      assert.equal((await runCli(['demo'])).state, 'follow-up');
      assert.equal(
        (await runCli(['demo', 'ü'.repeat(1500)])).state,
        'follow-up',
      );
      assert.equal(
        (await runCli(['demo', 'ü'.repeat(2048)])).state,
        'follow-up',
      );
      assert.equal((await runCli(['demo', 'Gespräch beenden'])).state, 'idle');
      assert.equal((await runCli(['activate'])).state, 'listening');
      assert.equal((await runCli(['demo', 'Gute Nacht Jarvis'])).state, 'idle');
      assert.equal(
        (await runCli(['demo', `${'a'.repeat(79)}😀`])).state,
        'follow-up',
      );
      assert.equal((await runCli(['demo', 'Mehr dazu?'])).state, 'follow-up');
      assert.equal((await runCli(['demo', 'Gespräch beenden'])).state, 'idle');
      // The contextual answer's 22-unit prefix places this emoji at unit 79.
      assert.equal(
        (await runCli(['demo', `${'b'.repeat(57)}😀`])).state,
        'follow-up',
      );
      assert.equal((await runCli(['demo', 'Mehr dazu?'])).state, 'follow-up');
      assert.equal((await runCli(['demo', 'Und danach?'])).state, 'follow-up');
      assert.equal((await runCli(['demo', 'Gespräch beenden'])).state, 'idle');
      assert.doesNotMatch(
        routineLogs,
        /private fixture|Wie geht es dir|simulierte Antwort|Gespräch beenden|Gute Nacht Jarvis|😀|Mehr dazu|Und danach/,
      );
      assert.match(routineLogs, /playback_completed/);
      audio.kill('SIGTERM');
      await once(audio, 'exit');
      const degraded = spawn('node', ['dist/apps/core/main.js', 'health'], {
        env,
      });
      let degradedOutput = '';
      degraded.stdout.on('data', (chunk) => {
        degradedOutput += chunk;
      });
      const [degradedCode] = await once(degraded, 'exit');
      assert.equal(degradedCode, 1);
      assert.equal(JSON.parse(degradedOutput).ready, false);
      assert.equal(JSON.parse(degradedOutput).audio_diagnostic, 'unavailable');
      await start('.venv/bin/python', ['apps/audio/main.py']);
      for (const name of ['audio', 'core']) {
        for (const [frame, expected] of [
          [
            '{"version":99,"type":"hello","private":"secret"}\n',
            'incompatible_version',
          ],
          [
            '{"version":1,"type":"hello","role":"unknown","private":"secret"}\n',
            'invalid_message',
          ],
          ['secret-not-json\n', 'invalid_message'],
          [`${'x'.repeat(9000)}\n`, 'frame_too_large'],
        ]) {
          const socket = createConnection(
            join(runtime, 'jarvis', `${name}.sock`),
          );
          socket.write(frame ?? '');
          let response = '';
          socket.on('data', (chunk) => {
            response += chunk;
          });
          await once(socket, 'close');
          assert.equal(JSON.parse(response).code, expected);
          assert.doesNotMatch(response, /secret/);
        }
        const hello = `{"version":1,"type":"hello","role":"${name === 'audio' ? 'core' : 'cli'}"}\n`;
        const utf16be = Buffer.from(hello, 'utf16le').swap16();
        const utf32be = Buffer.concat(
          Array.from(hello, (character) =>
            Buffer.from([0, 0, 0, character.charCodeAt(0)]),
          ),
        );
        // Invalid UTF-8 inside a valid JSON string must not become replacement text.
        const invalidUtf8 = Buffer.concat([
          Buffer.from(hello.slice(0, hello.indexOf('"role":'))),
          Buffer.from('"role":"'),
          Buffer.from([0xff]),
          Buffer.from('"}\n'),
        ]);
        for (const frame of [utf16be, utf32be, invalidUtf8]) {
          const socket = createConnection(
            join(runtime, 'jarvis', `${name}.sock`),
          );
          socket.write(frame);
          let response = '';
          socket.on('data', (chunk) => {
            response += chunk;
          });
          await once(socket, 'close');
          assert.equal(JSON.parse(response).code, 'invalid_message');
        }
        // Slow peers must not create an unbounded application queue.
        const peers: {
          socket: import('node:net').Socket;
          response: string;
          closed: Promise<unknown>;
        }[] = [];
        for (let count = 0; count < 9; count++) {
          const socket = createConnection(
            join(runtime, 'jarvis', `${name}.sock`),
          );
          const peer = { socket, response: '', closed: once(socket, 'close') };
          socket.on('data', (chunk) => {
            peer.response += chunk;
          });
          peers.push(peer);
          await once(socket, 'connect');
        }
        const overflow = peers[8];
        assert.ok(overflow);
        await overflow.closed;
        assert.equal(overflow.response, '');
        await Promise.all(peers.slice(0, 8).map((peer) => peer.closed));
        for (const peer of peers.slice(0, 8)) {
          assert.equal(JSON.parse(peer.response).code, 'timeout');
        }
      }
    } finally {
      for (const child of children) child.kill('SIGTERM');
      await Promise.all(
        children.map((child) =>
          child.exitCode === null ? once(child, 'exit') : Promise.resolve(),
        ),
      );
      rmSync(runtime, { recursive: true });
    }
  },
);

test(
  'a stalled audio peer produces bounded degraded health, then a valid reconnect restores readiness',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    delete env.JARVIS_CONFIG;
    const core = spawn('node', ['dist/apps/core/main.js', 'start'], { env });
    await once(core.stdout, 'data');
    const audioPath = join(runtime, 'jarvis/audio.sock');
    let mode: 'stall' | 'ready' = 'stall';
    const peers = new Set<import('node:net').Socket>();
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('data', () => {
        if (mode === 'ready')
          socket.end(
            '{"version":1,"type":"ready","service":"audio","mode":"mock"}\n',
          );
      });
    });
    try {
      audio.listen(audioPath);
      await once(audio, 'listening');
      const health = async () => {
        const child = spawn('node', ['dist/apps/core/main.js', 'health'], {
          env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const [code] = await once(child, 'exit');
        assert.equal(stderr, '');
        return { code, status: JSON.parse(stdout) };
      };
      const degraded = await health();
      assert.equal(degraded.code, 1);
      assert.equal(degraded.status.audio_diagnostic, 'timeout');
      mode = 'ready';
      const recovered = await health();
      assert.equal(recovered.code, 0);
      assert.equal(recovered.status.ready, true);
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
  'invalid Unicode audio requests release capacity and return content-free errors',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    env.JARVIS_CONFIG = join(runtime, 'config.yaml');
    writeFileSync(
      env.JARVIS_CONFIG,
      JSON.stringify({ transport: { max_frame_bytes: 65536 } }),
    );
    const audio = spawn('.venv/bin/python', ['apps/audio/main.py'], { env });
    let errors = '';
    audio.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const limits = {
      timeout_ms: 1000,
      max_frame_bytes: 8192,
      max_connections: 8,
    };
    try {
      await once(audio.stdout, 'data');
      for (let attempt = 0; attempt < 9; attempt++) {
        const response = await request(
          join(runtime, 'jarvis/audio.sock'),
          'core',
          limits,
          {
            version: 1,
            type: 'audio-operation',
            operation: {
              type: 'play',
              operation_id: String(attempt),
              text: 'private fixture \ud800',
            },
          },
        );
        assert.deepEqual(response, {
          version: 1,
          type: 'error',
          code: 'invalid_message',
        });
      }
      assert.deepEqual(
        await request(join(runtime, 'jarvis/audio.sock'), 'core', limits),
        { version: 1, type: 'ready', service: 'audio', mode: 'mock' },
      );
      const playback = await request(
        join(runtime, 'jarvis/audio.sock'),
        'core',
        limits,
        {
          version: 1,
          type: 'audio-operation',
          operation: { type: 'play', operation_id: 'valid', text: 'ü😀' },
        },
      );
      assert.deepEqual(playback, {
        version: 1,
        type: 'audio-result',
        operation_id: 'valid',
        completed: true,
        delivered_chars: 3,
      });
      const largePlayback = await request(
        join(runtime, 'jarvis/audio.sock'),
        'core',
        limits,
        {
          version: 1,
          type: 'audio-operation',
          operation: {
            type: 'play',
            operation_id: 'supplementary',
            text: '😀'.repeat(4096),
          },
        },
      );
      assert.deepEqual(largePlayback, {
        version: 1,
        type: 'audio-result',
        operation_id: 'supplementary',
        completed: true,
        delivered_chars: 8192,
      });
      assert.equal(errors, '');
    } finally {
      audio.kill('SIGTERM');
      await once(audio, 'exit');
      rmSync(runtime, { recursive: true });
    }
  },
);

test(
  'CLI stop and replacement interrupt pending playback without stale work resuming',
  { timeout: 10000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_HOME: join(runtime, 'config'),
    };
    delete env.JARVIS_CONFIG;
    const core = spawn('node', ['dist/apps/core/main.js', 'start'], { env });
    let logs = '';
    core.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    core.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    await once(core.stdout, 'data');
    const peers = new Set<import('node:net').Socket>();
    let played: () => void = () => {};
    let pending: import('node:net').Socket | undefined;
    let playbackId = '';
    const cancelled: string[] = [];
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('close', () => peers.delete(socket));
      socket.on('error', () => {});
      socket.on('data', (frame) => {
        const message = JSON.parse(frame.toString());
        if (message.type === 'hello') {
          socket.end(
            '{"version":1,"type":"ready","service":"audio","mode":"mock"}\n',
          );
          return;
        }
        const op = message.operation;
        if (op.type === 'play') {
          pending = socket;
          playbackId = op.operation_id;
          played();
          return;
        }
        if (op.type === 'cancel') cancelled.push(op.target_operation_id);
        socket.end(
          `${JSON.stringify({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize' ? { text: op.text } : {}),
            ...(['acknowledge', 'close-conversation', 'cancel'].includes(
              op.type,
            )
              ? {
                  completed: op.type !== 'cancel',
                  delivered_chars: op.type === 'cancel' ? 4 : 0,
                }
              : {}),
          })}\n`,
        );
      });
    });
    const cli = async (...args: string[]) => {
      const child = spawn('node', ['dist/apps/core/main.js', ...args], { env });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      await once(child, 'exit');
      return output ? JSON.parse(output) : undefined;
    };
    try {
      audio.listen(join(runtime, 'jarvis/audio.sock'));
      await once(audio, 'listening');
      for (const control of ['stop', 'activate']) {
        const started = new Promise<void>((resolve) => {
          played = resolve;
        });
        const turn = cli('demo', 'private replacement fixture');
        await started;
        const interruptedId = playbackId;
        const result = await cli(control);
        assert.equal(
          result.state,
          control === 'stop' ? 'follow-up' : 'listening',
        );
        assert.equal(cancelled.at(-1), interruptedId);
        if (control === 'activate')
          assert.equal((await cli('demo', 'Gespräch beenden')).state, 'idle');
        pending?.end(
          `${JSON.stringify({ version: 1, type: 'audio-result', operation_id: interruptedId, completed: true, delivered_chars: 42 })}\n`,
        );
        await turn;
        assert.equal(
          (await cli('health')).state,
          control === 'activate' ? 'idle' : 'follow-up',
        );
      }
      assert.equal((await cli('demo', 'Gespräch beenden')).state, 'idle');
      assert.doesNotMatch(
        logs,
        /private replacement fixture|simulierte Antwort|Gespräch beenden/,
      );
    } finally {
      core.kill('SIGTERM');
      await once(core, 'exit');
      for (const peer of peers) peer.destroy();
      await new Promise<void>((resolve) => audio.close(() => resolve()));
      rmSync(runtime, { recursive: true });
    }
  },
);
