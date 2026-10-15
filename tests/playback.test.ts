import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('real audio mode rejects missing voice with a content-free startup diagnostic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jv-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      audio: { mode: 'piper' },
      tts: { model_path: join(dir, 'private-missing.onnx') },
    }),
  );
  const child = spawn('.venv/bin/python', ['apps/audio/main.py'], {
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: dir,
      JARVIS_CONFIG: join(dir, 'config.json'),
    },
  });
  let output = '';
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output, /missing_voice/);
    assert.doesNotMatch(output, /private-missing|Traceback/);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true });
  }
});

test('protocol accepts real TTS readiness while recognition and inference remain scripted', async () => {
  const { parseMessage } = await import('../packages/protocol/index.js');
  assert.deepEqual(
    parseMessage(
      Buffer.from(
        '{"version":1,"type":"ready","service":"audio","mode":"piper","capabilities":{"wake":"unavailable","stt":"mock","tts":"ready"}}',
      ),
    ),
    {
      version: 1,
      type: 'ready',
      service: 'audio',
      mode: 'piper',
      capabilities: { wake: 'unavailable', stt: 'mock', tts: 'ready' },
    },
  );
});
