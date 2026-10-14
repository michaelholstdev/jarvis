import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCore } from '../apps/core/core.js';

test('scripted service events expose readiness and latency without requesting speech or inference', () => {
  let now = 100;
  const core = createCore({ now: () => now });
  assert.equal(core.status().ready, false);
  core.dispatch({ type: 'audio-ready' });
  now = 125;
  assert.deepEqual(core.status(), {
    ready: true,
    mode: 'mock',
    state: 'idle',
    manual_activation: 'unavailable',
    voice_conversation: 'unavailable',
    audio: 'ready',
    audio_diagnostic: null,
    since_ms: 25,
  });
  assert.deepEqual(core.operations(), []);
  core.dispatch({ type: 'audio-lost' });
  assert.equal(core.status().ready, false);
  core.dispatch({ type: 'audio-ready' });
  assert.deepEqual(core.operations(), []);
});
