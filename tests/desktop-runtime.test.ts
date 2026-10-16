import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from '../apps/core/transport.js';
import type { HealthStatus } from '../packages/protocol/index.js';

// Recorded command/event shapes substitute only the desktop/PipeWire processes.
const fixture = `#!/usr/bin/env python3
import sys,os,json,time
from pathlib import Path
state=Path(os.environ['DESKTOP_FIXTURE'])
name=Path(sys.argv[0]).name
args=sys.argv[1:]
def read(): return json.loads(state.read_text())
if name=='busctl':
 s=read()
 if s.get('slow'):
  Path(str(state)+'.reading').write_text('reading')
  time.sleep(1.2)
 print('b '+str(s['locked'] if 'GetActive' in args else s['sleeping']).lower())
elif name=='pactl' and 'get-source-mute' in args:
 print('Mute: '+('yes' if read()['muted'] else 'no'))
elif name=='pactl' and 'list' in args:
 s=read(); source='sources' in args
 print(json.dumps([{'name':'mic' if source else 'speaker','index':s['device'],'mute':s['muted'] if source else False}]))
else:
 last=None
 while True:
  s=read()
  if s.get('offline'): sys.exit(1)
  current=json.dumps(s)
  if last is not None and current!=last:
   if name=='pactl': print("Event 'change' on source #1",flush=True)
   elif '--session' in args and s['locked']!=json.loads(last)['locked']: print('/ScreenSaver: org.freedesktop.ScreenSaver.ActiveChanged ('+str(s['locked']).lower()+',)',flush=True)
   elif '--system' in args and s['sleeping']!=json.loads(last)['sleeping']: print('/org/freedesktop/login1: org.freedesktop.login1.Manager.PrepareForSleep ('+str(s['sleeping']).lower()+',)',flush=True)
  last=current; time.sleep(.03)
`;

test(
  'installed desktop entrypoint inhibits actual socket activation, survives monitor loss and never resumes canceled turns',
  { timeout: 20000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'jv-desk-'));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    for (const command of ['busctl', 'gdbus', 'pactl'])
      writeFileSync(join(bin, command), fixture, { mode: 0o700 });
    const file = join(root, 'desktop.json');
    const state = {
      locked: false,
      sleeping: false,
      muted: false,
      device: 1,
      offline: false,
      slow: false,
    };
    const update = (change: Partial<typeof state>) => {
      Object.assign(state, change);
      writeFileSync(file, JSON.stringify(state));
    };
    update({});
    const config = join(root, 'config.yaml');
    writeFileSync(
      config,
      'audio:\n  input_device: mic\n  output_device: speaker\n',
    );
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: root,
      JARVIS_CONFIG: config,
      PATH: `${bin}:${process.env.PATH}`,
      DESKTOP_FIXTURE: file,
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
          throw new Error(logs);
        }),
      ]);
    };
    const limits = {
      timeout_ms: 1500,
      max_frame_bytes: 8192,
      max_connections: 8,
    };
    const socket = join(root, 'jarvis/core.sock');
    const health = async () => {
      const result = await request(socket, 'cli', limits);
      assert.ok(result.type === 'ready' && result.service === 'core');
      return result.status;
    };
    const until = async (
      predicate: (status: HealthStatus) => boolean,
      timeout = 5000,
    ) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const status = await health();
        if (predicate(status)) return status;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      assert.fail(
        `desktop did not reconcile: ${JSON.stringify(await health())}`,
      );
    };
    try {
      await start('.venv/bin/python', ['apps/audio/main.py']);
      await start('node', ['dist/apps/core/main.js', 'start-desktop']);
      await until((status) => status.manual_activation === 'mock');
      const wait = spawnSync(
        '.venv/bin/python',
        ['scripts/service-runtime.py', 'wait', 'core'],
        { env, timeout: 6000 },
      );
      assert.equal(wait.status, 0);
      await request(socket, 'cli', limits, {
        version: 1,
        type: 'demo',
        text: 'private desktop fixture',
      });
      update({ locked: true, muted: true });
      await until(
        (status) =>
          status.inhibitions.locked &&
          status.inhibitions.hardware_muted &&
          !status.privacy_pending,
      );
      assert.deepEqual(
        await request(socket, 'cli', limits, { version: 1, type: 'activate' }),
        { version: 1, type: 'error', code: 'unavailable' },
      );
      await request(socket, 'cli', limits, {
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: true,
      });
      update({ locked: false, muted: false });
      await until(
        (status) =>
          !status.inhibitions.locked && !status.inhibitions.hardware_muted,
      );
      assert.equal((await health()).manual_activation, 'unavailable');
      await request(socket, 'cli', limits, {
        version: 1,
        type: 'inhibition-changed',
        source: 'muted',
        active: false,
      });
      await until((status) => status.manual_activation === 'mock');
      // A slow unrelated desktop snapshot cannot delay a received source mute.
      update({ slow: true });
      const readingDeadline = Date.now() + 4000;
      while (!existsSync(`${file}.reading`) && Date.now() < readingDeadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(existsSync(`${file}.reading`));
      update({ muted: true });
      await until((status) => status.inhibitions.hardware_muted, 900);
      update({ slow: false, muted: false });
      await until((status) => status.manual_activation === 'mock');
      update({ sleeping: true });
      await until((status) => status.inhibitions.locked);
      update({ sleeping: false, device: 2 });
      await until((status) => status.manual_activation === 'mock');
      update({ offline: true });
      await until((status) => status.inhibitions.locked);
      update({ offline: false });
      const restored = await until(
        (status) => status.manual_activation === 'mock',
      );
      assert.equal(restored.state, 'idle');
      const text = await request(socket, 'cli', limits, {
        version: 1,
        type: 'text-answer-request',
        offset: 0,
      });
      assert.ok(text.type === 'text-answer' && text.text === null);
      assert.ok(!logs.includes('private desktop fixture'));
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await exited;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
