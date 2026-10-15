import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import type { HealthStatus, Operation } from '../packages/protocol/index.js';

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

const stages = {
  idle: ['idle', undefined],
  acknowledging: ['acknowledging', 'acknowledge'],
  listening: ['listening', 'recognize'],
  thinking: ['thinking', 'infer'],
  synthesizing: ['synthesizing', 'synthesize'],
  speaking: ['speaking', 'play'],
  'follow-up': ['follow-up', 'recognize'],
  'extension-synthesis': ['awaiting-extension', 'synthesize'],
  'extension-playback': ['awaiting-extension', 'play'],
  'extension-listening': ['awaiting-extension', 'recognize'],
  cancelling: ['cancelling', 'cancel'],
  closing: ['idle', 'close-conversation'],
} as const satisfies Record<
  string,
  readonly [HealthStatus['state'], Operation['type'] | undefined]
>;

for (const source of ['locked', 'muted', 'hardware_muted'] as const) {
  for (const stage of Object.keys(stages) as (keyof typeof stages)[]) {
    test(`${source} clears ${stage} and rejects stale work before and after release`, () => {
      let now = 0;
      const config = loadConfig();
      config.session.max_duration_seconds = 30;
      const core = createCore({ now: () => now }, config);
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
      const enter: Record<keyof typeof stages, () => void> = {
        idle: () => {},
        acknowledging: () => core.activate(),
        listening: () => {
          enter.acknowledging();
          play();
        },
        thinking: () => {
          enter.listening();
          recognize('Private Frage');
        },
        synthesizing: () => {
          enter.thinking();
          infer();
        },
        speaking: () => {
          enter.synthesizing();
          synthesize();
        },
        'follow-up': () => {
          enter.speaking();
          play(15);
        },
        'extension-synthesis': () => {
          enter.listening();
          now = 29000;
          recognize('Private Frage');
          infer();
          synthesize();
          play(15);
          now = 30000;
          core.dispatch({ type: 'tick' });
        },
        'extension-playback': () => {
          enter['extension-synthesis']();
          synthesize();
        },
        'extension-listening': () => {
          enter['extension-playback']();
          const prompt = current().text;
          assert.ok(prompt);
          play(prompt.length);
        },
        cancelling: () => {
          enter.speaking();
          core.stop();
        },
        closing: () => {
          enter['follow-up']();
          recognize('Gespräch beenden');
        },
      };
      enter[stage]();
      assert.equal(core.status().state, stages[stage][0]);
      assert.equal(core.operations()[0]?.type, stages[stage][1]);
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
