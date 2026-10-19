import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

const generated =
  'So summierst du Werte.\n\n```python\nprint(1 + 2)\n```\n\nDie Ergebnisse stehen in der Tabelle.\n\n| Name | Wert |\n| --- | --- |\n| Summe | 3 |';
const contentSummary =
  'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.';
const spoken =
  'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.\n\nDie Antwort enthält Code und eine Tabelle. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.';

function fixture(text = generated, summary: string | null = contentSummary) {
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
  if (core.operations()[0]?.type === 'infer' && summary !== null) {
    core.dispatch({
      type: 'inferred',
      operation_id: core.operations()[0]?.operation_id ?? '',
      text: summary,
    });
  }
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
  assert.equal(core.textAnswer()?.text ?? null, generated);
});

test('duration-limited speech keeps full text but only the played prefix and notice enter context', async () => {
  const original =
    'Ein Computer verarbeitet Daten und führt Programme aus. '.repeat(20);
  const speech =
    'Ein Computer verarbeitet Daten und führt Programme aus. Die Antwort ist zu lang zum Vorlesen. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.';
  const { core, recognize } = fixture(original);
  const directory = mkdtempSync(join(tmpdir(), 'jv-long-speech-'));
  const path = join(directory, 'audio.sock');
  const audio = createServer((socket) => {
    socket.once('data', (frame) => {
      const message = parseMessage(frame);
      assert.equal(message.type, 'audio-operation');
      if (message.type !== 'audio-operation') return;
      const op = message.operation;
      assert.equal(core.textAnswer()?.text, original);
      if (op.type === 'play') assert.equal(op.text, speech);
      socket.end(
        encodeMessage({
          version: 1,
          type: 'audio-result',
          operation_id: op.operation_id,
          ...(op.type === 'synthesize'
            ? { text: speech }
            : { completed: true, delivered_chars: speech.length }),
        }),
      );
    });
  });
  audio.listen(path);
  await once(audio, 'listening');
  try {
    await runTurn(core, path, loadConfig());
    assert.equal(core.reply()?.text, speech);
    assert.equal(core.textAnswer()?.text, original);
    recognize('Bitte weiter.');
    assert.equal(core.operations()[0]?.context?.[0]?.reply, speech);
    core.dispatch({
      type: 'inhibition-changed',
      source: 'locked',
      active: true,
    });
    assert.equal(core.textAnswer(), null);
  } finally {
    await new Promise<void>((resolve) => audio.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});

test('stopping duration-limited speech excludes the unheard notice and remainder from context', () => {
  const original =
    'Ein Computer verarbeitet Daten und führt Programme aus. '.repeat(20);
  const speech =
    'Ein Computer verarbeitet Daten und führt Programme aus. Die Antwort ist zu lang zum Vorlesen.';
  const { core, recognize } = fixture(original);
  core.dispatch({
    type: 'synthesized',
    operation_id: core.operations()[0]?.operation_id ?? '',
    text: speech,
  });
  assert.equal(core.operations()[0]?.text, speech);
  core.stop();
  core.dispatch({
    type: 'playback-completed',
    operation_id: core.operations()[0]?.operation_id ?? '',
    completed: false,
    delivered_chars: 56,
  });
  assert.equal(core.textAnswer()?.text, original);
  recognize('Bitte weiter.');
  assert.equal(
    core.operations()[0]?.context?.[0]?.reply,
    'Ein Computer verarbeitet Daten und führt Programme aus. ',
  );
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
  assert.equal(core.textAnswer()?.text ?? null, generated);
  assert.deepEqual(core.reply(), {
    text: 'Das Be',
    completed: false,
    delivered_chars: 6,
  });
  recognize('Bitte ausführlicher.');
  assert.deepEqual(core.operations()[0]?.context, [
    { question: 'Zeige mir ein Beispiel.', reply: 'Das Be' },
  ]);
  assert.equal(core.operations()[0]?.text, 'Bitte ausführlicher.');
  assert.equal(core.textAnswer()?.text ?? null, null);
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
    assert.equal(core.textAnswer()?.text ?? null, generated);
    if (cleanup === 'end') recognize('Gespräch beenden');
    else if (cleanup === 'timeout') advance();
    else
      core.dispatch({
        type: 'inhibition-changed',
        source: cleanup,
        active: true,
      });
    assert.equal(core.textAnswer()?.text ?? null, null);
    core.dispatch({ type: 'inferred', operation_id: stale, text: generated });
    assert.equal(core.textAnswer()?.text ?? null, null);
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
    'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ein Beispiel.\n\n```python\nSECRET_CODE',
    'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ein Beispiel.\n\n      SECRET_CODE',
    'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.\n\nDie Antwort enthält Code. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
  [
    'Ergebnis.\n\nName | Zahl\n--- | ---\nSECRET_ROW | 42',
    'Das Beispiel addiert eins und zwei. Die Tabelle zeigt die Summe drei.\n\nDie Antwort enthält eine Tabelle. Den vollständigen Text kannst du mit dem CLI-Befehl „text“ ansehen.',
  ],
] as const) {
  test(`spoken formatting preserves prose and hides formatted material: ${JSON.stringify(text)}`, () => {
    const { core } = fixture(text);
    assert.equal(core.operations()[0]?.text, expected);
    assert.equal(core.textAnswer()?.text ?? null, text);
  });
}

test('a near-limit formatted answer still has bounded speech with its text-access notice', () => {
  const text = `${'ü'.repeat(2020)}\n\n\`\`\`\nx\n\`\`\``;
  const { core } = fixture(text, 'ü'.repeat(2020));
  const speech = core.operations()[0]?.text ?? '';
  assert.ok(Buffer.byteLength(speech) <= 4096);
  assert.match(speech, /CLI-Befehl „text“ ansehen\.$/);
  assert.equal(core.textAnswer()?.text ?? null, text);
});

test('formatted-only answers request a content-bearing summary while retaining the original text', () => {
  const original = '```python\nprint(1 + 2)\n```';
  const { core, recognize } = fixture(original, null);
  assert.equal(core.operations()[0]?.type, 'infer');
  assert.match(core.operations()[0]?.text ?? '', /Zusammenfassung/);
  assert.match(core.operations()[0]?.text ?? '', /print\(1 \+ 2\)/);
  assert.equal(core.textAnswer()?.text ?? null, original);
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
  assert.equal(core.textAnswer()?.text ?? null, original);
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
    const { core } = fixture(original, null);
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
    if (action === 'lock') assert.equal(core.textAnswer()?.text ?? null, null);
    else assert.equal(core.textAnswer()?.text ?? null, original);
  });
}

for (const formatted of [
  '> ```python\n> SECRET_CODE\n> ```',
  '\t\tSECRET_CODE',
  'Name | Zahl\n- | -\nSECRET_ROW | 3\nAndere | 4',
  '1. Beispiel\n\n   ```python\n   SECRET_CODE\n   ```',
]) {
  test('nested code and short-delimiter tables are kept out of speech', () => {
    const original = `Das Beispiel addiert zwei Zahlen.\n\n${formatted}`;
    const { core } = fixture(original);
    assert.equal(core.operations()[0]?.type, 'synthesize');
    assert.match(core.operations()[0]?.text ?? '', /addiert eins und zwei/);
    assert.doesNotMatch(core.operations()[0]?.text ?? '', /SECRET|```|\|/);
    assert.match(core.operations()[0]?.text ?? '', /CLI-Befehl „text“/);
    assert.equal(core.textAnswer()?.text ?? null, original);
  });
}

test('introductory prose still requires a content-bearing summary', () => {
  const original = 'Hier ist der Code:\n\n```python\nprint(1 + 2)\n```';
  const { core } = fixture(original, null);
  assert.equal(core.operations()[0]?.type, 'infer');
  assert.match(core.operations()[0]?.text ?? '', /Zusammenfassung/);
});
