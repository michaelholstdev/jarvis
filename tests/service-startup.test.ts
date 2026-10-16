import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('service preparation restricts XDG paths, reclaims a crashed socket and preserves a live service', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'jv-unit-'));
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: join(runtime, 'config'),
    XDG_STATE_HOME: join(runtime, 'state'),
  };
  const prepare = () =>
    spawnSync(
      '.venv/bin/python',
      ['scripts/service-runtime.py', 'prepare', 'audio'],
      { env, encoding: 'utf8' },
    );
  try {
    assert.equal(prepare().status, 0);
    for (const path of ['jarvis', 'config/jarvis', 'state/jarvis'])
      assert.equal(statSync(join(runtime, path)).mode & 0o777, 0o700);
    const path = join(runtime, 'jarvis/audio.sock');
    assert.equal(
      spawnSync('.venv/bin/python', [
        '-c',
        'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])',
        path,
      ]).status,
      0,
    );
    assert.equal(prepare().status, 0);
    assert.equal(existsSync(path), false);
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      assert.notEqual(prepare().status, 0);
      assert.equal(existsSync(path), true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    writeFileSync(path, 'keep');
    assert.notEqual(prepare().status, 0);
    assert.equal(existsSync(path), true);
    rmSync(path);
    rmSync(join(runtime, 'state/jarvis'), { recursive: true });
    mkdirSync(join(runtime, 'state/jarvis'), { mode: 0o755 });
    assert.notEqual(prepare().status, 0);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
