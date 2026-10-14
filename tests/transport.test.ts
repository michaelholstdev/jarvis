import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
    const children: ReturnType<typeof spawn>[] = [];
    const start = async (command: string, args: string[]) => {
      const child = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
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
