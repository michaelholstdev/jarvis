import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCore } from '../apps/core/core.js';

function fixture() {
  let now = 0;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  const current = () => {
    const operation = core.operations()[0];
    assert.ok(operation);
    return operation;
  };
  const play = (delivered_chars = 0) =>
    core.dispatch({
      type: 'playback-completed',
      operation_id: current().operation_id,
      completed: true,
      delivered_chars,
    });
  const recognize = (text: string) =>
    core.dispatch({
      type: 'recognized',
      operation_id: current().operation_id,
      text,
    });
  core.activate();
  play();
  recognize('Erste Frage');
  core.dispatch({
    type: 'inferred',
    operation_id: current().operation_id,
    text: 'Erste Antwort',
  });
  core.dispatch({ type: 'synthesized', operation_id: current().operation_id });
  play(13);
  return {
    core,
    current,
    play,
    recognize,
    at: (time: number) => {
      now = time;
    },
  };
}

test('failed question retries only on standalone request and preserves completed context', () => {
  const { core, current, play, recognize } = fixture();
  recognize('Zweite Frage');
  const failed = current();
  core.dispatch({
    type: 'operation-failed',
    operation_id: failed.operation_id,
    code: 'unavailable',
    capability: 'inference',
  });
  assert.equal(current().type, 'cancel');
  play();
  assert.equal(current().type, 'indicate-failure');
  play();
  assert.equal(core.status().retry_available, true);
  core.dispatch({
    type: 'capabilities-changed',
    capabilities: { inference: 'mock' },
  });
  assert.equal(current().type, 'recognize');
  core.dispatch({
    type: 'inferred',
    operation_id: failed.operation_id,
    text: 'Späte Antwort',
  });
  assert.equal(current().type, 'recognize');
  core.dispatch({
    type: 'operation-failed',
    operation_id: failed.operation_id,
    code: 'timeout',
    capability: 'stt',
  });
  assert.equal(current().type, 'recognize');
  recognize(' NOCH EINMAL! ');
  assert.equal(current().type, 'infer');
  assert.equal(current().text, 'Zweite Frage');
  assert.deepEqual(current().context, [
    { question: 'Erste Frage', reply: 'Erste Antwort' },
  ]);
});

test('socket loss retains context only within the original recovery window and never replays', () => {
  const { core, current, recognize, at } = fixture();
  recognize('Fehlgeschlagene Frage');
  const old = current();
  core.dispatch({ type: 'audio-lost' });
  assert.equal(core.status().retry_available, true);
  assert.deepEqual(core.operations(), []);
  at(1000);
  core.dispatch({ type: 'audio-lost' });
  core.dispatch({ type: 'audio-ready' });
  assert.equal(current().type, 'privacy');
  core.dispatch({
    type: 'privacy-applied',
    operation_id: current().operation_id,
  });
  assert.equal(current().type, 'recognize');
  core.dispatch({
    type: 'inferred',
    operation_id: old.operation_id,
    text: 'Veraltet',
  });
  recognize('Neue Frage statt Wiederholung');
  assert.equal(current().text, 'Neue Frage statt Wiederholung');
  assert.equal(core.status().retry_available, false);
  assert.deepEqual(current().context, [
    { question: 'Erste Frage', reply: 'Erste Antwort' },
  ]);
  core.dispatch({ type: 'audio-lost' });
  at(21000);
  core.dispatch({ type: 'tick' });
  core.dispatch({ type: 'audio-ready' });
  assert.equal(core.status().state, 'idle');
  assert.equal(core.status().retry_available, false);
});

test('stalled inference is canceled before one indication; stalled cancellation degrades without loops', () => {
  const { core, current, recognize, at } = fixture();
  recognize('Timeout Frage');
  const old = current();
  at(1000);
  core.dispatch({ type: 'tick' });
  assert.equal(current().type, 'cancel');
  assert.equal(current().target_operation_id, old.operation_id);
  assert.equal(core.status().last_failure?.code, 'timeout');
  at(2000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().audio, 'unavailable');
  assert.deepEqual(core.operations(), []);
  at(2001);
  core.dispatch({ type: 'tick' });
  assert.deepEqual(core.operations(), []);
  assert.equal(core.status().retry_available, true);
});

test('capability loss at idle is silent and missing wake retains manual readiness', () => {
  const core = createCore({ now: () => 0 });
  core.dispatch({
    type: 'audio-ready',
    capabilities: {
      wake: 'unavailable',
      stt: 'unavailable',
      tts: 'unavailable',
      inference: 'unavailable',
    },
  });
  assert.equal(core.status().manual_activation, 'mock');
  assert.equal(core.status().voice_conversation, 'unavailable');
  assert.deepEqual(core.status().capabilities, {
    wake: 'unavailable',
    stt: 'unavailable',
    tts: 'unavailable',
    inference: 'unavailable',
  });
  for (let count = 0; count < 100; count++) {
    core.dispatch({
      type: 'capabilities-changed',
      capabilities: { stt: 'unavailable' },
    });
    core.dispatch({ type: 'tick' });
  }
  assert.deepEqual(core.operations(), []);
});

test('failure cue is requested once; retry without a failed question never invokes inference', () => {
  const { core, current, play, recognize } = fixture();
  recognize('„Noch einmal“');
  assert.equal(current().text, '„Noch einmal“');
  core.dispatch({
    type: 'operation-failed',
    operation_id: current().operation_id,
    code: 'unavailable',
    capability: 'tts',
  });
  play();
  const cue = current();
  assert.equal(cue.type, 'indicate-failure');
  play();
  core.dispatch({
    type: 'playback-completed',
    operation_id: cue.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  assert.equal(current().type, 'recognize');
  recognize('Gespräch beenden');
  core.activate();
  play();
  recognize('Noch einmal');
  assert.equal(core.status().state, 'idle');
  assert.notEqual(core.operations()[0]?.type, 'infer');
});

test('playback watchdog waits for cancellation delivery and keeps only the heard prefix', () => {
  const { core, current, recognize, at, play } = fixture();
  recognize('Zweite Frage');
  core.dispatch({
    type: 'inferred',
    operation_id: current().operation_id,
    text: 'Hallo. Ungehört.',
  });
  core.dispatch({ type: 'synthesized', operation_id: current().operation_id });
  at(120000);
  core.dispatch({ type: 'tick' });
  assert.equal(current().type, 'cancel');
  core.dispatch({
    type: 'playback-completed',
    operation_id: current().operation_id,
    completed: false,
    delivered_chars: 6,
  });
  play();
  recognize('Neue Frage');
  assert.deepEqual(current().context, [
    { question: 'Erste Frage', reply: 'Erste Antwort' },
    { question: 'Zweite Frage', reply: 'Hallo.' },
  ]);
});

test('an interrupted playback completion keeps its failed question available for explicit retry', () => {
  for (const delivered of [0, 6]) {
    const { core, current, recognize, play } = fixture();
    recognize('Unvollständig');
    core.dispatch({
      type: 'inferred',
      operation_id: current().operation_id,
      text: 'Hallo. Rest.',
    });
    core.dispatch({
      type: 'synthesized',
      operation_id: current().operation_id,
    });
    core.dispatch({
      type: 'playback-completed',
      operation_id: current().operation_id,
      completed: false,
      delivered_chars: delivered,
    });
    assert.equal(current().type, 'indicate-failure');
    play();
    assert.equal(core.status().retry_available, true);
    recognize('Noch einmal');
    assert.equal(current().text, 'Unvollständig');
    assert.deepEqual(current().context, [
      { question: 'Erste Frage', reply: 'Erste Antwort' },
      ...(delivered ? [{ question: 'Unvollständig', reply: 'Hallo.' }] : []),
    ]);
  }
});

test('a healthy handshake cannot release uncertain playback until silent cleanup is acknowledged', () => {
  const { core, current, recognize, at } = fixture();
  recognize('Fehlgeschlagene Wiedergabe');
  core.dispatch({
    type: 'inferred',
    operation_id: current().operation_id,
    text: 'Unbestätigte Antwort',
  });
  core.dispatch({ type: 'synthesized', operation_id: current().operation_id });
  const playback = current();
  at(120000);
  core.dispatch({ type: 'tick' });
  const cancellation = current();
  at(121000);
  core.dispatch({ type: 'tick' });
  core.dispatch({ type: 'audio-ready' });
  assert.equal(core.status().ready, false);
  assert.equal(core.status().manual_activation, 'unavailable');
  assert.throws(() => core.activate(), /unavailable/);
  const cleanup = current();
  assert.equal(cleanup.type, 'privacy');
  assert.deepEqual(cleanup.inhibitions, {
    locked: false,
    muted: false,
    hardware_muted: false,
  });
  for (const old of [playback, cancellation])
    core.dispatch({
      type: 'playback-completed',
      operation_id: old.operation_id,
      completed: true,
      delivered_chars: 0,
    });
  assert.deepEqual(core.operations(), [cleanup]);
  core.dispatch({ type: 'audio-ready' });
  assert.deepEqual(core.operations(), [cleanup]);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: cleanup.operation_id,
  });
  assert.equal(core.status().ready, true);
  assert.equal(current().type, 'recognize');
  assert.equal(core.status().retry_available, true);
  recognize('Noch einmal');
  assert.equal(current().text, 'Fehlgeschlagene Wiedergabe');
  assert.deepEqual(current().context, [
    { question: 'Erste Frage', reply: 'Erste Antwort' },
  ]);
});

test('failed cleanup remains gated across expiry and reconnect until a current acknowledgment', () => {
  const { core, current, recognize, at } = fixture();
  recognize('Ausstehende Frage');
  core.dispatch({ type: 'audio-lost' });
  core.dispatch({ type: 'audio-ready' });
  const oldCleanup = current();
  at(1000);
  core.dispatch({ type: 'tick' });
  assert.deepEqual(core.operations(), []);
  assert.equal(core.status().audio_cleanup_pending, true);
  at(20000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().retry_available, false);
  assert.equal(core.reply(), null);
  core.dispatch({ type: 'audio-ready' });
  const freshCleanup = current();
  assert.notEqual(freshCleanup.operation_id, oldCleanup.operation_id);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: oldCleanup.operation_id,
  });
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: freshCleanup.operation_id,
  });
  assert.equal(core.status().state, 'idle');
  assert.equal(core.status().audio_cleanup_pending, false);
  assert.deepEqual(core.operations(), []);
  core.activate();
  assert.equal(current().type, 'acknowledge');
});

test('mute supersedes recovery cleanup and cannot release it through a stale acknowledgment', () => {
  const { core, current, recognize } = fixture();
  recognize('Ausstehende Frage');
  core.dispatch({ type: 'audio-lost' });
  core.dispatch({ type: 'audio-ready' });
  const recovery = current();
  core.dispatch({ type: 'inhibition-changed', source: 'muted', active: true });
  const mute = current();
  core.dispatch({
    type: 'privacy-applied',
    operation_id: recovery.operation_id,
  });
  assert.throws(() => core.activate(), /unavailable/);
  assert.equal(core.status().retry_available, false);
  core.dispatch({ type: 'privacy-applied', operation_id: mute.operation_id });
  assert.equal(core.status().audio_cleanup_pending, false);
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({ type: 'inhibition-changed', source: 'muted', active: false });
  core.dispatch({
    type: 'privacy-applied',
    operation_id: current().operation_id,
  });
  core.activate();
  assert.equal(current().type, 'acknowledge');
});
