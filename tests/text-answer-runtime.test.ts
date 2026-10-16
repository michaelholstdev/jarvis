import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { request } from '../apps/core/transport.js';
import type { Message } from '../packages/protocol/index.js';

const answer =
  'Private Erklärung.\n\n```sh\necho SECRET_CODE\n```\n\n| Name | Zahl |\n| --- | --- |\n| SECRET_ROW | 42 |';

test(
  'CLI text deliberately displays the full answer, honors detail instructions, and clears with the session',
  { timeout: 15000 },
  async () => {
    const runtime = mkdtempSync(join(tmpdir(), 'jv-text-'));
    let generatedAnswer = answer;
    const histories: { role: string; content: string }[][] = [];
    const ollama = createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'test:local' }] }));
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const messages = JSON.parse(body).messages;
        histories.push(messages);
        const content = messages
          .at(-1)
          .content.startsWith('Gib eine kurze, inhaltliche Zusammenfassung')
          ? 'Das Beispiel gibt eine private Begrüßung aus.'
          : generatedAnswer;
        res.end(`${JSON.stringify({ message: { content }, done: true })}\n`);
      });
    });
    ollama.listen(0, '127.0.0.1');
    await once(ollama, 'listening');
    const address = ollama.address();
    assert.ok(address && typeof address !== 'string');
    const configPath = join(runtime, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        llm: {
          mode: 'ollama',
          model: 'test:local',
          base_url: `http://127.0.0.1:${address.port}`,
        },
      }),
    );
    const env = {
      ...process.env,
      XDG_RUNTIME_DIR: runtime,
      JARVIS_CONFIG: configPath,
    };
    let logs = '';
    const children: ReturnType<typeof spawn>[] = [];
    const start = async (command: string, args: string[]) => {
      const child = spawn(command, args, { env });
      children.push(child);
      child.stdout.on('data', (chunk) => {
        logs += chunk;
      });
      child.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(() => {
          throw new Error('startup_failed');
        }),
      ]);
    };
    const send = (message?: Message) =>
      request(
        join(runtime, 'jarvis/core.sock'),
        'cli',
        { timeout_ms: 4000, max_frame_bytes: 8192, max_connections: 8 },
        message,
      );
    const cli = async (command: string) => {
      const child = spawn('node', ['dist/apps/core/main.js', command], { env });
      let output = '';
      let errors = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        errors += chunk;
      });
      const [code] = await once(child, 'exit');
      assert.equal(code, 0, errors);
      return output;
    };
    try {
      await start('.venv/bin/python', ['apps/audio/main.py']);
      await start('node', ['dist/apps/core/main.js', 'start']);
      assert.equal(
        await cli('text'),
        'Keine Textantwort in dieser Sitzung verfügbar.\n',
      );
      const result = await send({
        version: 1,
        type: 'demo',
        text: 'Private Frage mit Beispiel',
      });
      assert.equal(result.type, 'ready');
      assert.doesNotMatch(JSON.stringify(result), /Private Erklärung|SECRET/);
      assert.equal(await cli('text'), `${answer}\n`);
      await send({
        version: 1,
        type: 'demo',
        text: 'Bitte ausführlicher mit Details.',
      });
      const messages = histories[1];
      assert.ok(messages);
      assert.match(messages[0]?.content ?? '', /Deutsch/);
      assert.match(messages[0]?.content ?? '', /knapp/);
      assert.match(messages[0]?.content ?? '', /ausführlich/);
      assert.equal(
        messages.at(-1)?.content,
        'Bitte ausführlicher mit Details.',
      );
      assert.match(messages[2]?.content ?? '', /CLI-Befehl „text“/);
      assert.doesNotMatch(messages[2]?.content ?? '', /SECRET|```|\|/);
      generatedAnswer = '```sh\necho SECRET_ONLY_CODE\n```';
      await send({
        version: 1,
        type: 'demo',
        text: 'Private Frage nur mit Code',
      });
      assert.equal(await cli('text'), `${generatedAnswer}\n`);
      assert.match(histories.at(-1)?.at(-1)?.content ?? '', /Zusammenfassung/);
      await send({
        version: 1,
        type: 'demo',
        text: 'Private Folgefrage zur Zusammenfassung',
      });
      const followUp = [...histories]
        .reverse()
        .find(
          (messages) =>
            messages.at(-1)?.content ===
            'Private Folgefrage zur Zusammenfassung',
        );
      assert.ok(followUp);
      assert.match(
        followUp.at(-2)?.content ?? '',
        /gibt eine private Begrüßung aus/,
      );
      assert.doesNotMatch(followUp.at(-2)?.content ?? '', /SECRET|```/);
      generatedAnswer = answer;
      for (const source of ['locked', 'muted', 'hardware_muted'] as const) {
        await send({
          version: 1,
          type: 'inhibition-changed',
          source,
          active: true,
        });
        assert.equal(
          await cli('text'),
          'Keine Textantwort in dieser Sitzung verfügbar.\n',
        );
        await send({
          version: 1,
          type: 'inhibition-changed',
          source,
          active: false,
        });
        assert.equal(
          await cli('text'),
          'Keine Textantwort in dieser Sitzung verfügbar.\n',
        );
        await send({
          version: 1,
          type: 'demo',
          text: 'Private Frage mit Beispiel',
        });
      }
      await send({ version: 1, type: 'demo', text: 'Gespräch beenden' });
      assert.equal(
        await cli('text'),
        'Keine Textantwort in dieser Sitzung verfügbar.\n',
      );
      assert.doesNotMatch(
        logs,
        /Private Frage|Private Erklärung|private Begrüßung|SECRET|ausführlicher|Gespräch beenden/,
      );
    } finally {
      for (const child of children.reverse()) {
        if (child.exitCode === null) {
          child.kill('SIGTERM');
          await once(child, 'exit');
        }
      }
      ollama.closeAllConnections();
      await new Promise<void>((resolve) => ollama.close(() => resolve()));
      rmSync(runtime, { recursive: true });
    }
  },
);
