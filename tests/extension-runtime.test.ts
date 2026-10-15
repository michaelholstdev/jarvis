import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { request } from '../apps/core/transport.js';
import type { Message } from '../packages/protocol/index.js';

test(
  'daemon prompts on its own ticker and CLI extension controls cross the Python audio boundary',
  { timeout: 40000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-ext-'));
    const configPath = join(runtime, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        session: { max_duration_seconds: 30, follow_up_seconds: 60 },
      }),
    );
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      JARVIS_CONFIG: configPath,
    };
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
    const send = async (message?: Message) => {
      const result = await request(
        join(runtime, 'jarvis/core.sock'),
        'cli',
        {
          timeout_ms: 6000,
          max_frame_bytes: 8192,
          max_connections: 8,
        },
        message,
      );
      assert.ok(result.type === 'ready' && result.service === 'core');
      return result.status;
    };
    try {
      await start('.venv/bin/python', ['apps/audio/main.py']);
      await start('node', ['dist/apps/core/main.js', 'start']);
      assert.equal(
        (
          await send({
            version: 1,
            type: 'demo',
            text: 'private expiry fixture',
          })
        ).state,
        'follow-up',
      );
      // Exercise automatic expiry with no incoming CLI requests.
      await setTimeout(30500);
      assert.match(
        logs,
        /"operation":"synthesize".*"state":"awaiting-extension"/,
      );
      assert.match(logs, /"operation":"play".*"state":"awaiting-extension"/);
      assert.equal((await send()).state, 'awaiting-extension');
      assert.equal(
        (await send({ version: 1, type: 'demo', text: 'Eine normale Frage' }))
          .state,
        'awaiting-extension',
      );
      assert.equal(
        (await send({ version: 1, type: 'demo', text: 'Weiter' })).state,
        'follow-up',
      );
      assert.equal(
        (await send({ version: 1, type: 'demo', text: 'Und danach?' })).state,
        'follow-up',
      );
      assert.equal(
        (await send({ version: 1, type: 'demo', text: 'Gespräch beenden' }))
          .state,
        'idle',
      );
      assert.doesNotMatch(
        logs,
        /private expiry fixture|Eine normale Frage|Möchtest du|Und danach/,
      );
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          await once(child, 'exit');
        }
      }
      rmSync(runtime, { recursive: true });
    }
  },
);
