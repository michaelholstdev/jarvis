import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { test } from 'node:test';
import { receive } from '../apps/core/transport.js';
import { encodeMessage, type Message } from '../packages/protocol/index.js';

const limits = { timeout_ms: 100, max_frame_bytes: 1024, max_connections: 8 };

async function decode(chunks: Buffer[], progress: Message[] = []) {
  const socket = new Socket();
  const result = receive(socket, limits, (message) => progress.push(message));
  try {
    // Inject transport reads so coalescing and fragmentation are deterministic.
    for (const chunk of chunks) socket.emit('data', chunk);
    return await result;
  } finally {
    socket.destroy();
  }
}

test('progress and final frames each fit the limit even when their shared read exceeds it', async () => {
  const progress: Message = {
    version: 1,
    type: 'speech-started',
    operation_id: '1',
  };
  const final: Message = {
    version: 1,
    type: 'audio-result',
    operation_id: '1',
    text: 'x'.repeat(910),
  };
  const bytes = Buffer.from(encodeMessage(progress) + encodeMessage(final));
  for (const chunks of [
    [bytes],
    [bytes.subarray(0, 30), bytes.subarray(30, 500), bytes.subarray(500)],
  ]) {
    const observed: Message[] = [];
    assert.deepEqual(await decode(chunks, observed), final);
    assert.deepEqual(observed, [progress]);
  }
});

test('frame bounds include the newline and reject oversized complete or fragmented frames', async () => {
  const final: Message = {
    version: 1,
    type: 'audio-result',
    operation_id: '1',
    text: 'x'.repeat(959),
  };
  const exact = Buffer.from(encodeMessage(final));
  assert.equal(exact.length, 1024);
  assert.deepEqual(await decode([exact]), final);
  const oversized = Buffer.from(
    encodeMessage({ ...final, text: 'x'.repeat(960) }),
  );
  for (const chunks of [
    [oversized],
    [oversized.subarray(0, 700), oversized.subarray(700)],
    [Buffer.alloc(1025, 120)],
  ]) {
    await assert.rejects(decode(chunks), /frame_too_large/);
  }
});

test('progress cannot repeat or renew the original response deadline', async () => {
  const progress = Buffer.from(
    encodeMessage({ version: 1, type: 'speech-started', operation_id: '1' }),
  );
  await assert.rejects(decode([progress, progress]), /invalid_message/);
  await assert.rejects(decode([progress]), /timeout/);
});
