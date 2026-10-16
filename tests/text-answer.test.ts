import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';

const generated =
  'So summierst du Werte.\n\n```python\nprint(1 + 2)\n```\n\nDie Ergebnisse stehen in der Tabelle.\n\n| Name | Wert |\n| --- | --- |\n| Summe | 3 |';
const spoken =
  'So summierst du Werte.\n\nDie Ergebnisse stehen in der Tabelle.\n\nDie Antwort enthält Code und eine Tabelle. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.';

function fixture(text = generated) {
  let now = 0;
  const config = loadConfig();
  config.interaction.activation_sound = false;
  const core = createCore({ now: () => now }, config);
  core.dispatch({ type: 'audio-ready' });
  core.activate();
  const recognize = (text: string) => {
    core.dispatch({
      type: 'recognized',
      operation_id: core.operations()[0]?.operation_id ?? '',
      text,
    });
  };
  recognize('Zeige mir ein Beispiel.');
  core.dispatch({
    type: 'inferred',
    operation_id: core.operations()[0]?.operation_id ?? '',
    text,
  });
  return {
    core,
    recognize,
    advance: () => {
      now += 20000;
      core.dispatch({ type: 'tick' });
    },
  };
}

test('code and tables remain available as temporary text while speech gives prose and a CLI notice', () => {
  const { core } = fixture();
  assert.equal(core.operations()[0]?.text, spoken);
  assert.equal(core.textAnswer(), generated);
});

test('viewing a stopped answer does not put its unheard remainder or formatting into follow-up context', () => {
  const { core, recognize } = fixture();
  core.dispatch({
    type: 'synthesized',
    operation_id: core.operations()[0]?.operation_id ?? '',
  });
  assert.equal(core.operations()[0]?.text, spoken);
  core.stop();
  core.dispatch({
    type: 'playback-completed',
    operation_id: core.operations()[0]?.operation_id ?? '',
    completed: false,
    delivered_chars: 6,
  });
  assert.equal(core.textAnswer(), generated);
  assert.deepEqual(core.reply(), {
    text: 'So sum',
    completed: false,
    delivered_chars: 6,
  });
  recognize('Bitte ausführlicher.');
  assert.deepEqual(core.operations()[0]?.context, [
    { question: 'Zeige mir ein Beispiel.', reply: 'So sum' },
  ]);
  assert.equal(core.operations()[0]?.text, 'Bitte ausführlicher.');
  assert.equal(core.textAnswer(), null);
});

for (const cleanup of [
  'end',
  'timeout',
  'locked',
  'muted',
  'hardware_muted',
] as const) {
  test(`temporary text is cleared by ${cleanup} and late generated results cannot restore it`, () => {
    const { core, recognize, advance } = fixture();
    const stale = core.operations()[0]?.operation_id ?? '';
    core.dispatch({ type: 'synthesized', operation_id: stale });
    core.dispatch({
      type: 'playback-completed',
      operation_id: core.operations()[0]?.operation_id ?? '',
      completed: true,
      delivered_chars: spoken.length,
    });
    assert.equal(core.textAnswer(), generated);
    if (cleanup === 'end') recognize('Gespräch beenden');
    else if (cleanup === 'timeout') advance();
    else
      core.dispatch({
        type: 'inhibition-changed',
        source: cleanup,
        active: true,
      });
    assert.equal(core.textAnswer(), null);
    core.dispatch({ type: 'inferred', operation_id: stale, text: generated });
    assert.equal(core.textAnswer(), null);
  });
}

for (const [text, expected] of [
  ['Das Zeichen | bedeutet hier oder.', 'Das Zeichen | bedeutet hier oder.'],
  [
    'Nur Prosa, gern ausführlich erklärt.',
    'Nur Prosa, gern ausführlich erklärt.',
  ],
  [
    'Ein Beispiel.\n\n~~~python\nSECRET_CODE\n~~~',
    'Ein Beispiel.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ein Beispiel.\n\n```python\nSECRET_CODE',
    'Ein Beispiel.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ein Beispiel.\n\n      SECRET_CODE',
    'Ein Beispiel.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ergebnis.\n\nName | Zahl\n--- | ---\nSECRET_ROW | 42',
    'Ergebnis.\n\nDie Antwort enthält eine Tabelle. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
] as const) {
  test(`spoken formatting preserves prose and hides formatted material: ${JSON.stringify(text)}`, () => {
    const { core } = fixture(text);
    assert.equal(core.operations()[0]?.text, expected);
    assert.equal(core.textAnswer(), text);
  });
}

test('a near-limit formatted answer still has bounded speech with its text-access notice', () => {
  const text = `${'ü'.repeat(2020)}\n\n\`\`\`\nx\n\`\`\``;
  const { core } = fixture(text);
  const speech = core.operations()[0]?.text ?? '';
  assert.ok(Buffer.byteLength(speech) <= 4096);
  assert.match(speech, /CLI-Befehl „text“ ansehen\.$/);
  assert.equal(core.textAnswer(), text);
});

test('formatted-only answers request a content-bearing summary while retaining the original text', () => {
  const original = '```python\nprint(1 + 2)\n```';
  const { core, recognize } = fixture(original);
  assert.equal(core.operations()[0]?.type, 'infer');
  assert.match(core.operations()[0]?.text ?? '', /Zusammenfassung/);
  assert.match(core.operations()[0]?.text ?? '', /print\(1 \+ 2\)/);
  assert.equal(core.textAnswer(), original);
  core.dispatch({
    type: 'inferred',
    operation_id: core.operations()[0]?.operation_id ?? '',
    text: 'Das Python-Beispiel addiert eins und zwei und gibt drei aus.',
  });
  const speech = core.operations()[0]?.text ?? '';
  assert.equal(core.operations()[0]?.type, 'synthesize');
  assert.match(speech, /addiert eins und zwei und gibt drei aus/);
  assert.match(speech, /CLI-Befehl „text“/);
  assert.doesNotMatch(speech, /print|```/);
  assert.equal(core.textAnswer(), original);
  core.dispatch({
    type: 'synthesized',
    operation_id: core.operations()[0]?.operation_id ?? '',
  });
  core.dispatch({
    type: 'playback-completed',
    operation_id: core.operations()[0]?.operation_id ?? '',
    completed: true,
    delivered_chars: speech.length,
  });
  recognize('Bitte ausführlicher.');
  assert.equal(core.operations()[0]?.context?.[0]?.reply, speech);
});

for (const action of ['unusable-summary', 'lock', 'replacement'] as const) {
  test(`formatted-only summary is bounded and cancellable: ${action}`, () => {
    const original = '| Name | Zahl |\n| --- | --- |\n| Summe | 3 |';
    const { core } = fixture(original);
    assert.equal(core.operations()[0]?.type, 'infer');
    const summaryId = core.operations()[0]?.operation_id ?? '';
    if (action === 'lock')
      core.dispatch({
        type: 'inhibition-changed',
        source: 'locked',
        active: true,
      });
    else if (action === 'replacement') core.activate();
    core.dispatch({
      type: 'inferred',
      operation_id: summaryId,
      text: '```\nSECRET_SUMMARY\n',
    });
    assert.notEqual(core.operations()[0]?.type, 'infer');
    assert.notEqual(core.operations()[0]?.type, 'synthesize');
    if (action === 'lock') assert.equal(core.textAnswer(), null);
    else assert.equal(core.textAnswer(), original);
  });
}
