import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCore } from '../apps/core/core.js';

function pending(core: ReturnType<typeof createCore>) {
  const operation = core.operations()[0];
  assert.ok(operation);
  return operation;
}

test('mute immediately clears delivered answers and blocks activation through cleanup and release', () => {
  const core = createCore({ now: () => 0 });
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const ack = core.operations()[0];
  assert.ok(ack);
  core.dispatch({ type: 'inhibition-changed', source: 'muted', active: true });
  assert.equal(core.status().manual_activation, 'unavailable');
  assert.equal(core.status().state, 'idle');
  assert.equal(core.reply(), null);
  const cleanup = core.operations()[0];
  assert.equal(cleanup?.type, 'privacy');
  assert.deepEqual(cleanup?.inhibitions, {
    locked: false,
    muted: true,
    hardware_muted: false,
  });
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({
    type: 'playback-completed',
    operation_id: ack.operation_id,
    completed: true,
    delivered_chars: 0,
  });
  assert.deepEqual(core.operations(), [cleanup]);
  core.dispatch({ type: 'inhibition-changed', source: 'muted', active: false });
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: cleanup?.operation_id ?? '',
  });
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: pending(core).operation_id,
  });
  assert.equal(core.status().manual_activation, 'mock');
  assert.deepEqual(core.operations(), []);
});

for (const first of ['locked', 'muted', 'hardware_muted'] as const) {
  for (const releaseFirst of [true, false]) {
    test(`${first} and another inhibition remain independent, release first=${releaseFirst}`, () => {
      const core = createCore({ now: () => 0 });
      core.dispatch({ type: 'audio-ready' });
      const second = first === 'locked' ? 'muted' : 'locked';
      for (const source of [first, second] as const) {
        core.dispatch({ type: 'inhibition-changed', source, active: true });
        core.dispatch({
          type: 'privacy-applied',
          operation_id: pending(core).operation_id,
        });
      }
      const order = releaseFirst
        ? ([first, second] as const)
        : ([second, first] as const);
      for (const [index, source] of order.entries()) {
        core.dispatch({ type: 'inhibition-changed', source, active: false });
        assert.throws(() => core.activate(), /unavailable/);
        core.dispatch({
          type: 'privacy-applied',
          operation_id: pending(core).operation_id,
        });
        if (index === 0) assert.throws(() => core.activate(), /unavailable/);
      }
      assert.equal(core.status().manual_activation, 'mock');
      assert.deepEqual(core.operations(), []);
    });
  }
}

for (const source of ['locked', 'muted', 'hardware_muted'] as const) {
  for (const stage of [
    'idle',
    'acknowledging',
    'listening',
    'thinking',
    'synthesizing',
    'speaking',
    'follow-up',
    'extension-synthesis',
    'extension-playback',
    'extension-listening',
    'cancelling',
    'closing',
  ] as const) {
    test(`${source} clears ${stage} and rejects stale work before and after release`, () => {
      let now = 0;
      const core = createCore({ now: () => now });
      core.dispatch({ type: 'audio-ready' });
      const current = () => pending(core);
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
      const infer = () =>
        core.dispatch({
          type: 'inferred',
          operation_id: current().operation_id,
          text: 'Private Antwort',
        });
      const synthesize = () =>
        core.dispatch({
          type: 'synthesized',
          operation_id: current().operation_id,
        });
      if (stage !== 'idle') core.activate();
      if (!['idle', 'acknowledging'].includes(stage)) play();
      if (!['idle', 'acknowledging', 'listening'].includes(stage))
        recognize('Private Frage');
      if (!['idle', 'acknowledging', 'listening', 'thinking'].includes(stage))
        infer();
      if (
        ![
          'idle',
          'acknowledging',
          'listening',
          'thinking',
          'synthesizing',
        ].includes(stage)
      )
        synthesize();
      if (
        [
          'follow-up',
          'extension-synthesis',
          'extension-playback',
          'extension-listening',
          'closing',
        ].includes(stage)
      ) {
        play(15);
        assert.equal(core.reply()?.text, 'Private Antwort');
      }
      if (stage.startsWith('extension-')) {
        // Keep the inactivity window open while reaching the allowance.
        for (now = 19000; now < 300000; now += 19000) {
          recognize('Weitere Frage');
          infer();
          synthesize();
          play(15);
        }
        now = 300000;
        core.dispatch({ type: 'tick' });
        if (stage !== 'extension-synthesis') synthesize();
        if (stage === 'extension-listening') {
          const prompt = current().text;
          assert.ok(prompt);
          play(prompt.length);
        }
      }
      if (stage === 'cancelling') core.stop();
      if (stage === 'closing') recognize('Gespräch beenden');
      const stale = core.operations()[0];
      core.dispatch({ type: 'inhibition-changed', source, active: true });
      assert.equal(core.status().state, 'idle');
      assert.equal(core.reply(), null);
      assert.equal(current().type, 'privacy');
      const privacyId = current().operation_id;
      const sendStale = () => {
        if (!stale) return;
        for (const type of [
          'recognized',
          'inferred',
          'control-recognized',
        ] as const)
          core.dispatch({
            type,
            operation_id: stale.operation_id,
            text: 'Weiter',
          });
        core.dispatch({
          type: 'synthesized',
          operation_id: stale.operation_id,
        });
        core.dispatch({
          type: 'speech-started',
          operation_id: stale.operation_id,
        });
        core.dispatch({
          type: 'playback-completed',
          operation_id: stale.operation_id,
          completed: true,
          delivered_chars: 14,
        });
      };
      sendStale();
      assert.equal(current().operation_id, privacyId);
      core.dispatch({ type: 'privacy-applied', operation_id: privacyId });
      core.dispatch({ type: 'audio-ready' });
      now += 999999;
      core.dispatch({ type: 'tick' });
      assert.throws(() => core.activate(), /unavailable/);
      core.dispatch({ type: 'inhibition-changed', source, active: false });
      core.dispatch({
        type: 'privacy-applied',
        operation_id: current().operation_id,
      });
      sendStale();
      assert.deepEqual(core.operations(), []);
      core.activate();
      play();
      recognize('Neue Frage');
      assert.deepEqual(current().context, []);
      assert.equal(core.reply(), null);
    });
  }
}

test('cleanup failure and service loss cannot erase inhibitions or allow activation before cleanup', () => {
  let now = 0;
  const core = createCore({ now: () => now });
  core.dispatch({ type: 'audio-ready' });
  core.dispatch({ type: 'inhibition-changed', source: 'locked', active: true });
  core.dispatch({
    type: 'inhibition-changed',
    source: 'locked',
    active: false,
  });
  now = 1000;
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().ready, false);
  core.dispatch({ type: 'audio-ready' });
  assert.throws(() => core.activate(), /unavailable/);
  core.dispatch({
    type: 'privacy-applied',
    operation_id: pending(core).operation_id,
  });
  core.dispatch({
    type: 'inhibition-changed',
    source: 'hardware_muted',
    active: true,
  });
  core.dispatch({ type: 'audio-lost' });
  core.dispatch({ type: 'audio-ready' });
  assert.equal(core.status().inhibitions.hardware_muted, true);
  assert.equal(core.operations()[0]?.type, 'privacy');
  core.dispatch({
    type: 'privacy-applied',
    operation_id: pending(core).operation_id,
  });
  assert.throws(() => core.activate(), /unavailable/);
});
