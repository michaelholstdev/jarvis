import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

test(
  'runtime speaks completed Ollama answers, retains delivered context and explicitly retries failure',
  { timeout: 5000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jv-llm-'));
    const path = join(directory, 'audio.sock');
    const config = loadConfig();
    config.llm.mode = 'ollama';
    const core = createCore({ now: () => 0 }, config);
    core.dispatch({ type: 'audio-ready' });
    core.dispatch({
      type: 'capabilities-changed',
      capabilities: { inference: 'ready' },
    });
    const diagnostics: Record<string, unknown>[] = [];
    const originalError = console.error;
    console.error = (line: string) => diagnostics.push(JSON.parse(line));
    const spoken: string[] = [];
    const histories: { role: string; content: string }[][] = [];
    let fail = false;
    let release = () => {};
    let started = () => {};
    let pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const ollama = httpServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        histories.push(JSON.parse(body).messages);
        if (fail) {
          res.writeHead(503);
          res.end();
          return;
        }
        res.write('{"message":{"content":"Berlin"},"done":false}\n');
        release = () =>
          res.end(
            '{"message":{"content":" ist die Hauptstadt."},"done":true}\n',
          );
        started();
      });
    });
    ollama.listen(0, '127.0.0.1');
    await once(ollama, 'listening');
    const address = ollama.address();
    assert.ok(address && typeof address !== 'string');
    config.llm.base_url = `http://127.0.0.1:${address.port}`;
    const peers = new Set<Socket>();
    const audio = createServer((socket) => {
      peers.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => peers.delete(socket));
      socket.once('data', (frame) => {
        const message = parseMessage(frame);
        assert.ok(message.type === 'audio-operation');
        const op = message.operation;
        if (op.type === 'synthesize') spoken.push(op.text ?? '');
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(op.type === 'recognize' ? { text: op.text } : {}),
            ...([
              'play',
              'acknowledge',
              'cancel',
              'indicate-failure',
              'close-conversation',
            ].includes(op.type)
              ? {
                  completed: op.type !== 'cancel',
                  delivered_chars:
                    op.type === 'play' ? (op.text?.length ?? 0) : 0,
                }
              : {}),
          }),
        );
      });
    });
    audio.listen(path);
    await once(audio, 'listening');
    try {
      core.activate();
      const turn = runTurn(core, path, config, 'Welche Hauptstadt?');
      await pending;
      assert.deepEqual(spoken, [], 'speech must wait for done');
      release();
      await turn;
      assert.deepEqual(spoken, ['Berlin ist die Hauptstadt.']);
      const token = diagnostics.filter(
        (event) => event.event === 'llm_first_token',
      );
      assert.equal(token.length, 1);
      assert.equal(typeof token[0]?.monotonic_ms, 'number');
      const inference = diagnostics.find(
        (event) => event.operation === 'infer',
      );
      assert.equal(token[0]?.operation_id, inference?.operation_id);
      assert.ok(inference?.turn_id);
      assert.equal(JSON.stringify(diagnostics).includes('Berlin'), false);
      assert.equal(core.status().state, 'follow-up');
      fail = true;
      await runTurn(core, path, config, 'Und wo liegt sie?');
      assert.equal(core.status().retry_available, true);
      assert.equal(core.status().last_failure?.capability, 'inference');
      assert.deepEqual(histories[1]?.slice(1), [
        { role: 'user', content: 'Welche Hauptstadt?' },
        { role: 'assistant', content: 'Berlin ist die Hauptstadt.' },
        { role: 'user', content: 'Und wo liegt sie?' },
      ]);
      core.dispatch({
        type: 'capabilities-changed',
        capabilities: { inference: 'ready' },
      });
      assert.equal(histories.length, 2, 'recovery does not replay');
      fail = false;
      pending = new Promise<void>((resolve) => {
        started = resolve;
      });
      const retry = runTurn(core, path, config, 'Noch einmal');
      await pending;
      release();
      await retry;
      assert.deepEqual(histories[2]?.at(-1), {
        role: 'user',
        content: 'Und wo liegt sie?',
      });
      assert.equal(core.status().retry_available, false);

      pending = new Promise<void>((resolve) => {
        started = resolve;
      });
      const canceled = runTurn(core, path, config, 'Verworfene Frage');
      await pending;
      core.activate();
      await runTurn(core, path, config);
      release();
      await canceled;
      assert.equal(
        spoken.length,
        2,
        'canceled generation cannot reach synthesis',
      );
      assert.equal(core.status().state, 'listening');
    } finally {
      console.error = originalError;
      for (const peer of peers) peer.destroy();
      ollama.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => ollama.close(() => resolve())),
        new Promise<void>((resolve) => audio.close(() => resolve())),
      ]);
      rmSync(directory, { recursive: true });
    }
  },
);
