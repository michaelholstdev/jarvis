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
    inhibitions: { locked: false, muted: false, hardware_muted: false },
    privacy_pending: false,
    mode: 'mock',
    state: 'idle',
    manual_activation: 'mock',
    voice_conversation: 'unavailable',
    audio: 'ready',
    audio_diagnostic: null,
    since_ms: 25,
    state_since_ms: 25,
  });
  assert.deepEqual(core.operations(), []);
  core.dispatch({ type: 'audio-lost' });
  assert.equal(core.status().ready, false);
  core.dispatch({ type: 'audio-ready' });
  assert.deepEqual(core.operations(), []);
});

test('conversation transitions preserve readiness age while watchdogs use turn timing', () => {
  let now = 100;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  now = 10100;
  core.activate();
  assert.equal(core.status().since_ms, 10000);
  assert.equal(core.status().state_since_ms, 0);
  const ack = core.operations()[0];
  assert.ok(ack);
  now = 10200;
  core.dispatch({
    type: 'playback-completed',
    operation_id: ack.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  assert.equal(core.status().state, 'listening');
  assert.equal(core.status().since_ms, 10100);
  assert.equal(core.status().state_since_ms, 0);
  now = 40200;
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'idle');
  assert.equal(core.status().since_ms, 40100);
  core.dispatch({ type: 'audio-lost' });
  assert.equal(core.status().since_ms, 0);
  now = 40300;
  core.dispatch({ type: 'audio-lost' });
  assert.equal(core.status().since_ms, 100);
  core.dispatch({ type: 'audio-ready' });
  assert.equal(core.status().since_ms, 0);
  now = 40400;
  core.dispatch({ type: 'audio-ready' });
  assert.equal(core.status().since_ms, 100);
});
