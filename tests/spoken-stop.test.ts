import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

test('spoken stop cancels through the audio socket and opens follow-up only after cancellation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jv-stop-'));
  const path = join(directory, 'audio.sock');
  const config = loadConfig();
  let now = 0;
  const core = createCore({ now: () => now }, config);
  core.dispatch({ type: 'audio-ready' });
  let stopped = false;
  const audio = createServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (frame) => {
      const message = parseMessage(frame);
      assert.equal(message.type, 'audio-operation');
      if (message.type !== 'audio-operation') return;
      const op = message.operation;
      if (op.type === 'play') {
        socket.write(
          `${JSON.stringify({ version: 1, type: 'control-stopped', operation_id: op.operation_id })}\n`,
        );
        return;
      }
      if (op.type === 'cancel') {
        assert.equal(core.status().state, 'cancelling');
        stopped = true;
        now = 4000;
      }
      socket.end(
        encodeMessage({
          version: 1,
          type: 'audio-result',
          operation_id: op.operation_id,
          ...(op.type === 'recognize' ? { text: 'Frage' } : {}),
          ...(['acknowledge', 'cancel'].includes(op.type)
            ? { completed: op.type !== 'cancel', delivered_chars: 0 }
            : {}),
        }),
      );
    });
  });
  audio.listen(path);
  await once(audio, 'listening');
  try {
    core.activate();
    await runTurn(core, path, config, 'Frage');
    await runTurn(core, path, config);
    assert.equal(stopped, true);
    assert.equal(core.status().state, 'follow-up');
    now = 23999;
    core.dispatch({ type: 'tick' });
    assert.equal(core.status().state, 'follow-up');
    now = 24000;
    core.dispatch({ type: 'tick' });
    assert.equal(core.status().state, 'idle');
  } finally {
    await new Promise<void>((resolve) => audio.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});
