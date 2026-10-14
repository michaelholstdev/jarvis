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
  assert.equal(core.status().state, 'follow-up');
  assert.equal(core.operations()[0]?.type, 'recognize');
  now = 20100;
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

function fixture() {
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
  return {
    core,
    at: (time: number) => {
      now = time;
    },
  };
}

function deliver(
  core: ReturnType<typeof createCore>,
  question = 'Was ist TypeScript?',
  answer = 'Eine Sprache.',
) {
  const recognition = core.operations()[0];
  assert.ok(recognition);
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: question,
  });
  const inference = core.operations()[0];
  assert.ok(inference);
  core.dispatch({
    type: 'inferred',
    operation_id: inference.operation_id,
    text: answer,
  });
  const synthesis = core.operations()[0];
  assert.ok(synthesis);
  core.dispatch({ type: 'synthesized', operation_id: synthesis.operation_id });
  const playback = core.operations()[0];
  assert.ok(playback);
  core.dispatch({
    type: 'playback-completed',
    operation_id: playback.operation_id,
    completed: true,
    delivered_chars: answer.length,
  });
}

test('completed exchanges inform a follow-up without activation', () => {
  const { core } = fixture();
  deliver(core);
  assert.equal(core.status().state, 'follow-up');
  const recognition = core.operations()[0];
  assert.ok(recognition);
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'Und JavaScript?',
  });
  assert.deepEqual(core.operations()[0], {
    type: 'infer',
    operation_id: core.operations()[0]?.operation_id,
    text: 'Und JavaScript?',
    context: [{ question: 'Was ist TypeScript?', reply: 'Eine Sprache.' }],
  });
});

test('long playback does not consume the follow-up window', () => {
  const { core, at } = fixture();
  const recognition = core.operations()[0];
  assert.ok(recognition);
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'Frage',
  });
  const inference = core.operations()[0];
  assert.ok(inference);
  core.dispatch({
    type: 'inferred',
    operation_id: inference.operation_id,
    text: 'Antwort',
  });
  const synthesis = core.operations()[0];
  assert.ok(synthesis);
  core.dispatch({ type: 'synthesized', operation_id: synthesis.operation_id });
  const playback = core.operations()[0];
  assert.ok(playback);
  at(45000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'speaking');
  core.dispatch({
    type: 'playback-completed',
    operation_id: playback.operation_id,
    completed: true,
    delivered_chars: 7,
  });
  at(64999);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'follow-up');
  at(65000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'idle');
  assert.equal(core.reply(), null);
});

test('near-deadline onset permits bounded completion without renewal from repeated onset', () => {
  const { core, at } = fixture();
  deliver(core);
  const recognition = core.operations()[0];
  assert.ok(recognition);
  at(19999);
  core.dispatch({
    type: 'speech-started',
    operation_id: recognition.operation_id,
  });
  at(22000);
  core.dispatch({
    type: 'speech-started',
    operation_id: recognition.operation_id,
  });
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'Mehr Details?',
  });
  assert.equal(core.operations()[0]?.type, 'infer');
  const stalled = fixture();
  deliver(stalled.core);
  const pending = stalled.core.operations()[0];
  assert.ok(pending);
  stalled.at(19999);
  stalled.core.dispatch({
    type: 'speech-started',
    operation_id: pending.operation_id,
  });
  stalled.at(25000);
  stalled.core.dispatch({
    type: 'recognized',
    operation_id: pending.operation_id,
    text: 'Zu spät',
  });
  assert.equal(stalled.core.status().state, 'idle');
  assert.equal(stalled.core.operations()[0]?.type, 'close-conversation');
});

test('noise and malformed results retain the original deadline and close if it passed', () => {
  const { core, at } = fixture();
  deliver(core);
  for (const [time, text] of [
    [5000, ''],
    [10000, '   '],
    [15000, 'x'.repeat(4097)],
  ] as const) {
    at(time);
    const recognition = core.operations()[0];
    assert.ok(recognition);
    core.dispatch({
      type: 'speech-started',
      operation_id: recognition.operation_id,
    });
    core.dispatch({
      type: 'recognized',
      operation_id: recognition.operation_id,
      text,
    });
    assert.equal(core.status().state, 'follow-up');
    assert.equal(core.operations()[0]?.type, 'recognize');
  }
  at(20000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'idle');
  for (const text of ['', ' ', 'x'.repeat(4097)]) {
    const pending = fixture();
    deliver(pending.core);
    const recognition = pending.core.operations()[0];
    assert.ok(recognition);
    pending.at(19999);
    pending.core.dispatch({
      type: 'speech-started',
      operation_id: recognition.operation_id,
    });
    pending.at(21000);
    pending.core.dispatch({
      type: 'recognized',
      operation_id: recognition.operation_id,
      text,
    });
    assert.equal(pending.core.status().state, 'idle');
    assert.equal(pending.core.operations()[0]?.type, 'close-conversation');
    assert.equal(pending.core.reply(), null);
  }
});

test('standalone German end phrases close before inference and clear context; quotations remain questions', () => {
  for (const text of [
    "Danke Jarvis, das war's",
    'Gespräch beenden',
    'Gute Nacht Jarvis',
    '  DANKE Jarvis, das war’s! ',
  ]) {
    const { core } = fixture();
    deliver(core);
    const recognition = core.operations()[0];
    assert.ok(recognition);
    core.dispatch({
      type: 'recognized',
      operation_id: recognition.operation_id,
      text,
    });
    assert.equal(core.status().state, 'idle');
    assert.equal(core.reply(), null);
    const closure = core.operations()[0];
    assert.equal(closure?.type, 'close-conversation');
    assert.equal(closure?.sound, true);
    core.activate();
    const ack = core.operations()[0];
    assert.ok(ack);
    core.dispatch({
      type: 'playback-completed',
      operation_id: ack.operation_id,
      completed: true,
      delivered_chars: 0,
    });
    const next = core.operations()[0];
    assert.ok(next);
    core.dispatch({
      type: 'recognized',
      operation_id: next.operation_id,
      text: 'Neue Frage',
    });
    assert.deepEqual(core.operations()[0]?.context, []);
  }
  for (const text of [
    'Was bedeutet Gespräch beenden?',
    '"Gute Nacht Jarvis"',
    '„Gespräch beenden“',
    "Er sagte Danke Jarvis, das war's",
    'Was bedeutet Stopp?',
  ]) {
    const { core } = fixture();
    const recognition = core.operations()[0];
    assert.ok(recognition);
    core.dispatch({
      type: 'recognized',
      operation_id: recognition.operation_id,
      text,
    });
    assert.equal(core.operations()[0]?.type, 'infer');
    assert.equal(core.operations()[0]?.text, text);
  }
});

test('follow-up timer boundaries and disabled end sound are honored', async () => {
  const { loadConfig } = await import('../apps/core/config.js');
  for (const seconds of [5, 20, 60]) {
    const config = loadConfig();
    config.session.follow_up_seconds = seconds;
    config.interaction.activation_sound = false;
    config.interaction.conversation_end_sound = false;
    let now = 0;
    const core = createCore({ now: () => now }, config);
    core.dispatch({ type: 'audio-ready' });
    core.activate();
    deliver(core);
    now = seconds * 1000 - 1;
    core.dispatch({ type: 'tick' });
    assert.equal(core.status().state, 'follow-up');
    now++;
    core.dispatch({ type: 'tick' });
    assert.equal(core.status().state, 'idle');
    assert.equal(core.operations()[0]?.sound, false);
  }
});

test('each valid reply opens a fresh window and expired recognition cannot reopen it', () => {
  const { core, at } = fixture();
  deliver(core);
  at(19000);
  deliver(core, 'Und dann?', 'Weitere Antwort.');
  at(38000);
  core.dispatch({ type: 'tick' });
  assert.equal(core.status().state, 'follow-up');
  const recognition = core.operations()[0];
  assert.ok(recognition);
  at(39000);
  core.dispatch({
    type: 'speech-started',
    operation_id: recognition.operation_id,
  });
  core.dispatch({
    type: 'recognized',
    operation_id: recognition.operation_id,
    text: 'Zu spät',
  });
  assert.equal(core.status().state, 'idle');
  assert.equal(core.reply(), null);
});
