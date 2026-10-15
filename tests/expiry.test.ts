import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Config, loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import type { Operation } from '../packages/protocol/index.js';

function conversation(session: Partial<Config['session']> = {}) {
  let now = 0;
  const config = loadConfig();
  config.session = { ...config.session, max_duration_seconds: 30, ...session };
  config.interaction.activation_sound = false;
  const core = createCore({ now: () => now }, config);
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const operation = (type: Operation['type']) => {
    const op = core.operations()[0];
    assert.ok(op);
    assert.equal(op.type, type);
    return op;
  };
  const recognize = (text: string) =>
    core.dispatch({
      type: 'recognized',
      operation_id: operation('recognize').operation_id,
      text,
    });
  const infer = (text = 'Antwort') =>
    core.dispatch({
      type: 'inferred',
      operation_id: operation('infer').operation_id,
      text,
    });
  const synthesize = () =>
    core.dispatch({
      type: 'synthesized',
      operation_id: operation('synthesize').operation_id,
    });
  const play = () => {
    const op = operation('play');
    assert.ok(op.text);
    core.dispatch({
      type: 'playback-completed',
      operation_id: op.operation_id,
      completed: true,
      delivered_chars: op.text.length,
    });
  };
  const answer = () => {
    infer();
    synthesize();
    play();
  };
  return {
    core,
    operation,
    recognize,
    infer,
    synthesize,
    play,
    answer,
    at: (time: number) => {
      now = time;
    },
    tick: () => core.dispatch({ type: 'tick' }),
  };
}

test('expiry leaves healthy playback intact and prompts after the delivered reply', () => {
  const c = conversation();
  c.at(29000);
  c.recognize('Frage');
  c.infer();
  c.synthesize();
  const playback = c.operation('play');
  c.at(31000);
  c.tick();
  assert.equal(c.core.status().state, 'speaking');
  assert.deepEqual(c.core.operations(), [playback]);
  c.play();
  assert.equal(c.core.status().state, 'awaiting-extension');
  assert.match(c.operation('synthesize').text ?? '', /Weiter/);
  assert.equal(c.core.reply()?.text, 'Antwort');
});

function finishBeforeExpiry(c: ReturnType<typeof conversation>) {
  c.at(29000);
  c.recognize('Frage');
  c.answer();
}

function promptBetweenTurns(c: ReturnType<typeof conversation>) {
  finishBeforeExpiry(c);
  c.at(30000);
  c.tick();
  assert.equal(c.core.status().state, 'awaiting-extension');
  c.operation('synthesize');
}

test('between-turn expiry prompts immediately; the response window begins after prompt playback', () => {
  const c = conversation();
  promptBetweenTurns(c);
  c.synthesize();
  c.at(55000);
  c.tick();
  c.operation('play');
  c.play();
  assert.equal(c.core.status().state, 'awaiting-extension');
  c.operation('recognize');
  c.at(74999);
  c.tick();
  assert.equal(c.core.status().state, 'awaiting-extension');
  c.at(75000);
  c.tick();
  assert.equal(c.core.status().state, 'idle');
  c.operation('close-conversation');
  assert.equal(c.core.reply(), null);
});

function awaitExtension(c: ReturnType<typeof conversation>) {
  promptBetweenTurns(c);
  c.synthesize();
  c.play();
}

test('only standalone Weiter renews the allowance with delivered context', () => {
  const c = conversation();
  awaitExtension(c);
  assert.throws(() => c.core.activate(), /busy/);
  for (const text of [
    'Was bedeutet Weiter?',
    '„Weiter“',
    '"Weiter"',
    'Weiter bitte',
    '',
    'x'.repeat(4097),
  ]) {
    c.at(49000);
    c.recognize(text);
    assert.equal(c.core.status().state, 'awaiting-extension');
    c.operation('recognize');
  }
  c.at(49999);
  c.recognize(' WEITER! ');
  assert.equal(c.core.status().state, 'follow-up');
  c.recognize('Nächste Frage');
  assert.deepEqual(c.operation('infer').context, [
    { question: 'Frage', reply: 'Antwort' },
  ]);
  c.answer();
  // Valid turns keep inactivity at bay, without renewing the duration allowance.
  for (let time = 69000; time < 349999; time += 19000) {
    c.at(time);
    c.recognize('Weitere Frage');
    c.answer();
  }
  c.at(349998);
  c.tick();
  assert.equal(c.core.status().state, 'follow-up');
  c.at(349999);
  c.tick();
  assert.equal(c.core.status().state, 'awaiting-extension');
});

for (const stage of ['listening', 'thinking', 'synthesizing'] as const) {
  test(`expiry during healthy ${stage} waits for the current turn`, () => {
    const c = conversation();
    finishBeforeExpiry(c);
    c.at(29900);
    if (stage === 'listening')
      c.core.dispatch({
        type: 'speech-started',
        operation_id: c.operation('recognize').operation_id,
      });
    else {
      c.recognize('Zweite Frage');
      if (stage === 'synthesizing') c.infer();
    }
    const pending = c.core.operations()[0];
    c.at(30100);
    c.tick();
    assert.equal(c.core.status().state, stage);
    assert.deepEqual(c.core.operations(), [pending]);
    if (stage === 'listening') c.recognize('Zweite Frage');
    if (stage !== 'synthesizing') c.infer();
    c.synthesize();
    c.play();
    assert.equal(c.core.status().state, 'awaiting-extension');
    c.operation('synthesize');
  });
}

test('empty recognition after expiry prompts rather than reopening normal follow-up', () => {
  const c = conversation();
  finishBeforeExpiry(c);
  c.at(29900);
  c.core.dispatch({
    type: 'speech-started',
    operation_id: c.operation('recognize').operation_id,
  });
  c.at(30100);
  c.recognize('');
  assert.equal(c.core.status().state, 'awaiting-extension');
  c.operation('synthesize');
});

for (const replacement of [false, true]) {
  test(`${replacement ? 'replacement' : 'stop'} at expiry cannot bypass explicit extension`, () => {
    const c = conversation();
    c.at(29000);
    c.recognize('Frage');
    c.infer();
    c.synthesize();
    c.at(30000);
    if (replacement) c.core.activate();
    else c.core.stop();
    const cancellation = c.operation('cancel');
    c.core.dispatch({
      type: 'playback-completed',
      operation_id: cancellation.operation_id,
      completed: false,
      delivered_chars: 3,
    });
    assert.equal(c.core.status().state, 'awaiting-extension');
    assert.equal(c.core.reply()?.text, 'Ant');
    c.operation('synthesize');
  });
}

test('manual activation between turns at expiry prompts rather than opening another question', () => {
  const c = conversation();
  finishBeforeExpiry(c);
  c.at(30000);
  c.core.activate();
  assert.equal(c.core.status().state, 'awaiting-extension');
  c.operation('synthesize');
});

test('speech onset and ignored questions do not renew extension timeout; closure clears context', () => {
  const c = conversation();
  awaitExtension(c);
  c.at(49999);
  const recognition = c.operation('recognize');
  c.core.dispatch({
    type: 'speech-started',
    operation_id: recognition.operation_id,
  });
  c.recognize('Eine normale Frage');
  c.at(50000);
  c.recognize('Weiter');
  assert.equal(c.core.status().state, 'idle');
  assert.equal(c.core.reply(), null);
  c.operation('close-conversation');
  c.core.activate();
  c.recognize('Neue Frage');
  assert.deepEqual(c.operation('infer').context, []);
});

for (const text of [
  "Danke Jarvis, das war's",
  'Gespräch beenden',
  'Gute Nacht Jarvis',
]) {
  test(`extension response ${text} closes and clears the conversation`, () => {
    const c = conversation();
    awaitExtension(c);
    c.recognize(text);
    assert.equal(c.core.status().state, 'idle');
    assert.equal(c.core.reply(), null);
    c.operation('close-conversation');
  });
}

test('extension commands during prompt playback are ignored and late recognition cannot renew', () => {
  const c = conversation();
  finishBeforeExpiry(c);
  const old = c.operation('recognize');
  c.at(30000);
  c.tick();
  c.core.dispatch({
    type: 'recognized',
    operation_id: old.operation_id,
    text: 'Weiter',
  });
  c.synthesize();
  const prompt = c.operation('play');
  c.core.dispatch({
    type: 'recognized',
    operation_id: prompt.operation_id,
    text: 'Weiter',
  });
  assert.deepEqual(c.core.operations(), [prompt]);
  c.play();
  c.at(50000);
  c.tick();
  assert.equal(c.core.status().state, 'idle');
});

test('configured extension response and duration are independent from inactivity', () => {
  const c = conversation({
    extension_response_seconds: 5,
    extension_duration_seconds: 30,
  });
  awaitExtension(c);
  c.at(34999);
  c.recognize('Weiter');
  c.recognize('Neue Frage');
  c.answer();
  c.at(50000);
  c.recognize('Weitere Frage');
  c.answer();
  c.at(64998);
  c.tick();
  assert.equal(c.core.status().state, 'follow-up');
  c.at(64999);
  c.tick();
  assert.equal(c.core.status().state, 'awaiting-extension');
  const silent = conversation({ extension_response_seconds: 5 });
  awaitExtension(silent);
  silent.at(35000);
  silent.tick();
  assert.equal(silent.core.status().state, 'idle');
});

test('five-minute allowance is distinct from follow-up inactivity and never resets on normal turns', () => {
  const c = conversation({ max_duration_seconds: 300 });
  finishBeforeExpiry(c);
  for (let time = 48000; time < 300000; time += 19000) {
    c.at(time);
    c.recognize('Frage');
    c.answer();
  }
  c.at(299999);
  c.tick();
  assert.equal(c.core.status().state, 'follow-up');
  c.at(300000);
  c.tick();
  assert.equal(c.core.status().state, 'awaiting-extension');
});

test('stalled-operation watchdog can interrupt work; late results cannot restart it', () => {
  const c = conversation();
  c.at(29900);
  c.recognize('Frage');
  const pending = c.operation('infer');
  c.at(30000);
  c.tick();
  assert.equal(c.core.status().state, 'thinking');
  c.at(30900);
  c.tick();
  assert.equal(c.core.status().state, 'idle');
  c.core.dispatch({
    type: 'inferred',
    operation_id: pending.operation_id,
    text: 'Späte Antwort',
  });
  assert.deepEqual(c.core.operations(), []);
});

test('an earlier inactivity deadline still closes when a delayed tick also passes the allowance', () => {
  const c = conversation({ max_duration_seconds: 300 });
  c.recognize('Frage');
  c.answer();
  c.at(300000);
  c.tick();
  assert.equal(c.core.status().state, 'idle');
  c.operation('close-conversation');
});

test('incomplete extension prompt closes instead of opening the response window', () => {
  const c = conversation();
  promptBetweenTurns(c);
  c.synthesize();
  const prompt = c.operation('play');
  c.core.dispatch({
    type: 'playback-completed',
    operation_id: prompt.operation_id,
    completed: false,
    delivered_chars: 0,
  });
  assert.equal(c.core.status().state, 'idle');
  assert.equal(c.core.reply(), null);
  c.operation('close-conversation');
});

for (const text of [
  "Danke Jarvis, das war's",
  'Gespräch beenden',
  'Gute Nacht Jarvis',
]) {
  test(`end command ${text} takes priority over allowance expiry between turns`, () => {
    const c = conversation();
    finishBeforeExpiry(c);
    c.at(30000);
    c.recognize(text);
    assert.equal(c.core.status().state, 'idle');
    assert.equal(c.core.reply(), null);
    c.operation('close-conversation');
    c.core.activate();
    c.recognize('Neue Frage');
    assert.deepEqual(c.operation('infer').context, []);
  });
}

for (const text of ['', '   ', 'x'.repeat(4097)]) {
  test(`expired inactivity closes after ${text.length === 4097 ? 'oversized' : text.length ? 'whitespace' : 'empty'} recognition even when the conversation allowance also expires`, () => {
    const c = conversation();
    c.at(9000);
    c.recognize('Frage');
    c.answer();
    c.at(28999);
    c.core.dispatch({
      type: 'speech-started',
      operation_id: c.operation('recognize').operation_id,
    });
    c.at(31000);
    c.recognize(text);
    assert.equal(c.core.status().state, 'idle');
    assert.equal(c.core.reply(), null);
    c.operation('close-conversation');
    c.core.activate();
    c.recognize('Neue Frage');
    assert.deepEqual(c.operation('infer').context, []);
  });
}
