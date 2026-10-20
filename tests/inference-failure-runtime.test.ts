import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

for (const reasoning of [false, true]) {
  test(`unusable ${reasoning ? 'reasoning-only token-limit' : 'empty'} response permits explicit retry without declaring an outage`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jv-empty-'));
    const path = join(directory, 'audio.sock');
    const config = loadConfig();
    Object.assign(config.llm, { mode: 'llama.cpp', provider: 'llama.cpp' });
    config.interaction.activation_sound = false;
    if (reasoning) {
      config.audio.mode = 'voice';
      config.wake_word.enabled = true;
    }
    const core = createCore({ now: () => 0 }, config);
    core.dispatch({ type: 'audio-ready', capabilities: { wake: 'ready' } });
    core.dispatch({
      type: 'capabilities-changed',
      capabilities: { inference: 'ready' },
    });
    const histories: unknown[] = [];
    let failed = false;
    const backend = httpServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        histories.push(JSON.parse(body).messages.slice(1));
        res.end(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: failed ? '' : 'SECRET_REPLY', ...(failed && reasoning ? { reasoning_content: 'SECRET_REASONING' } : {}) }, finish_reason: failed && reasoning ? 'length' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      });
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    config.llm.base_url = `http://127.0.0.1:${address.port}`;
    let suppliedQuestion = 'SECRET_FIRST';
    let indications = 0;
    const answers: string[] = [];
    const audio = createServer((socket) => {
      socket.once('data', (frame) => {
        const message = parseMessage(frame);
        assert.equal(message.type, 'audio-operation');
        if (message.type !== 'audio-operation') return;
        const op = message.operation;
        if (op.type === 'wake')
          socket.write(
            encodeMessage({
              version: 1,
              type: 'speech-started',
              operation_id: op.operation_id,
            }),
          );
        if (op.type === 'synthesize') answers.push(op.text ?? '');
        if (op.type === 'indicate-failure') indications++;
        socket.end(
          encodeMessage({
            version: 1,
            type: 'audio-result',
            operation_id: op.operation_id,
            ...(['recognize', 'wake'].includes(op.type)
              ? { text: op.text ?? suppliedQuestion }
              : {}),
            ...(['play', 'cancel', 'indicate-failure'].includes(op.type)
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
    const logs: Record<string, unknown>[] = [];
    const original = console.error;
    console.error = (line: string) => logs.push(JSON.parse(line));
    try {
      if (!reasoning) core.activate();
      await runTurn(core, path, config, 'SECRET_FIRST');
      failed = true;
      suppliedQuestion = 'SECRET_FAILED';
      await runTurn(core, path, config, 'SECRET_FAILED');
      assert.equal(core.status().capabilities.inference, 'ready');
      assert.equal(core.status().retry_available, true);
      assert.equal(indications, 1);
      assert.deepEqual(answers, ['SECRET_REPLY']);
      const firstInference = logs.find(
        (line) => line.event === 'inference_terminal',
      );
      const recognition = logs.find(
        (line) => line.operation === (reasoning ? 'wake' : 'recognize'),
      );
      assert.equal(firstInference?.turn_id, recognition?.operation_id);
      const terminal = logs.find(
        (line) =>
          line.event === 'inference_terminal' && line.outcome === 'failure',
      );
      assert.equal(terminal?.category, 'empty_answer');
      assert.equal(terminal?.finish_reason, reasoning ? 'length' : 'stop');
      assert.equal(terminal?.reasoning_chars, reasoning ? 16 : 'unknown');
      assert.ok(terminal?.turn_id);
      const boundary = logs.find((line) => line.event === 'operation_failed');
      assert.equal(boundary?.operation_id, terminal?.operation_id);
      assert.equal(boundary?.code, 'invalid_message');
      assert.equal(histories.length, 2, 'no automatic replay');
      failed = false;
      suppliedQuestion = 'Noch einmal';
      await runTurn(core, path, config, 'Noch einmal');
      assert.deepEqual(histories[2], [
        { role: 'user', content: 'SECRET_FIRST' },
        { role: 'assistant', content: 'SECRET_REPLY' },
        { role: 'user', content: 'SECRET_FAILED' },
      ]);
      assert.deepEqual(answers, ['SECRET_REPLY', 'SECRET_REPLY']);
      assert.equal(core.status().retry_available, false);
      assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
    } finally {
      console.error = original;
      backend.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => backend.close(() => resolve())),
        new Promise<void>((resolve) => audio.close(() => resolve())),
      ]);
      rmSync(directory, { recursive: true });
    }
  });
}
