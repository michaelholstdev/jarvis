import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runMockTurn } from '../apps/core/mock-turn.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

test('manual voice turn waits for the cue, recognizes without injected text, and stops capture after its reply', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jv-mic-'));
  const path = join(directory, 'audio.sock');
  const config = loadConfig();
  config.audio.mode = 'voice';
  const core = createCore({ now: () => 0 }, config);
  core.dispatch({
    type: 'audio-ready',
    capabilities: { stt: 'ready', tts: 'ready' },
  });
  const operations: string[] = [];
  const peers = new Set<Socket>();
  let releaseCue = () => {};
  let cueStarted = () => {};
  const cue = new Promise<void>((resolve) => {
    cueStarted = resolve;
  });
  const audio = createServer((socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => peers.delete(socket));
    socket.once('data', (frame) => {
      const message = parseMessage(frame);
      assert.ok(message.type === 'audio-operation');
      const op = message.operation;
      operations.push(op.type);
      const respond = () =>
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize'
              ? { text: 'Eine private Testfrage' }
              : {}),
            ...(['acknowledge', 'play'].includes(op.type)
              ? { completed: true, delivered_chars: op.text?.length ?? 0 }
              : {}),
          }),
        );
      if (op.type === 'recognize') assert.equal(op.text, undefined);
      if (op.type === 'acknowledge') {
        releaseCue = respond;
        cueStarted();
      } else respond();
    });
  });
  audio.listen(path);
  await once(audio, 'listening');
  try {
    await runMockTurn(core, path, config);
    assert.deepEqual(operations, [], 'idle never invokes recognition');
    core.activate();
    const turn = runMockTurn(core, path, config);
    await cue;
    assert.deepEqual(operations, ['acknowledge']);
    releaseCue();
    await turn;
    assert.deepEqual(operations, [
      'acknowledge',
      'recognize',
      'synthesize',
      'play',
    ]);
    assert.equal(core.status().state, 'follow-up');
    await runMockTurn(core, path, config);
    assert.equal(
      operations.length,
      4,
      'further microphone turns require activation',
    );
    core.dispatch({
      type: 'inhibition-changed',
      source: 'muted',
      active: true,
    });
    await runMockTurn(core, path, config);
    assert.throws(() => core.activate(), /unavailable/);
    await runMockTurn(core, path, config);
    assert.equal(operations.filter((op) => op === 'recognize').length, 1);
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => audio.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});
