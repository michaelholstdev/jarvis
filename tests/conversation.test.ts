import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCore } from '../apps/core/core.js';

test('manual listening waits for acknowledgment and completes only on delivered playback', () => {
  let now = 0;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const ack = core.operations()[0];
  assert.equal(ack?.type, 'acknowledge');
  assert.equal(core.status().state, 'acknowledging');
  assert.ok(ack);
  now = 100;
  core.dispatch({
    type: 'playback-completed',
    operation_id: ack.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  assert.equal(core.status().state, 'listening');
  const recognition = core.operations()[0];
  assert.equal(recognition?.type, 'recognize');
  assert.ok(recognition);
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'Wie geht es dir?',
  });
  const inference = core.operations()[0];
  assert.equal(inference?.type, 'infer');
  assert.ok(inference);
  core.dispatch({
    type: 'inferred',
    operation_id: inference.operation_id,
    text: 'Mir geht es gut.',
  });
  const synthesis = core.operations()[0];
  assert.ok(synthesis);
  core.dispatch({ type: 'synthesized', operation_id: synthesis.operation_id });
  const playback = core.operations()[0];
  assert.equal(playback?.type, 'play');
  assert.ok(playback);
  assert.equal(core.reply(), null);
  core.dispatch({
    type: 'playback-completed',
    operation_id: playback.operation_id,
    completed: true,
    delivered_chars: 16,
  });
  assert.deepEqual(core.reply(), {
    text: 'Mir geht es gut.',
    delivered_chars: 16,
    completed: true,
  });
  assert.equal(core.status().state, 'idle');
  assert.deepEqual(core.operations(), []);
  now = 1100;
  core.dispatch({ type: 'tick' });
  assert.equal(core.reply(), null);
});

test('idle ignores ambient recognition and stale service results', () => {
  const core = createCore({ now: () => 0 });
  core.dispatch({ type: 'audio-ready' });
  core.dispatch({
    type: 'recognized',
    operation_id: 'ambient',
    text: 'private ambient speech',
  });
  core.dispatch({
    type: 'inferred',
    operation_id: 'ambient',
    text: 'private answer',
  });
  assert.deepEqual(core.operations(), []);
  assert.equal(core.reply(), null);
});

test('listening is bounded and recovery cannot replay an expired turn', () => {
  let now = 0;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const ack = core.operations()[0];
  assert.ok(ack);
  core.dispatch({
    type: 'playback-completed',
    operation_id: ack.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  now = 30000;
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'idle');
  assert.deepEqual(core.operations(), []);
  core.dispatch({ type: 'audio-lost' });
  core.dispatch({ type: 'audio-ready' });
  assert.deepEqual(core.operations(), []);
});

test('disabled activation sound starts listening immediately; oversized recognition never invokes inference', async () => {
  const { loadConfig } = await import('../apps/core/config.js');
  const config = loadConfig();
  config.interaction.activation_sound = false;
  const core = createCore({ now: () => 0 }, config);
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  assert.equal(core.status().state, 'listening');
  const recognition = core.operations()[0];
  assert.ok(recognition);
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'a'.repeat(4097),
  });
  assert.deepEqual(core.operations(), []);
  assert.equal(core.status().state, 'idle');
});

test('an unfinished acknowledgment expires without listening and cannot complete a newer turn', () => {
  let now = 0;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const old = core.operations()[0];
  assert.ok(old);
  now = 1000;
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'idle');
  core.activate();
  core.dispatch({
    type: 'playback-completed',
    operation_id: old.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  assert.equal(core.status().state, 'acknowledging');
});
