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
import { probeInference } from '../apps/core/inference.js';
import { runTurn } from '../apps/core/turn-driver.js';
import { encodeMessage, parseMessage } from '../packages/protocol/index.js';

for (const provider of ['llama.cpp', 'ollama']) {
  for (const status of [400, 422, 503]) {
    test(`${provider} HTTP ${status} distinguishes request rejection from an outage without replay`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'jv-http-'));
      const path = join(directory, 'audio.sock');
      const config = loadConfig();
      Object.assign(config.llm, { mode: provider, provider });
      config.interaction.activation_sound = false;
      const core = createCore({ now: () => 0 }, config);
      core.dispatch({ type: 'audio-ready' });
      core.dispatch({
        type: 'capabilities-changed',
        capabilities: { inference: 'ready' },
      });
      let rejected = true;
      const questions: string[] = [];
      const backend = httpServer((req, res) => {
        if (req.url === '/health') {
          res.end('{"status":"ok"}');
          return;
        }
        if (req.url === '/v1/models') {
          res.end(JSON.stringify({ data: [{ id: config.llm.model }] }));
          return;
        }
        if (req.url === '/api/tags') {
          res.end(JSON.stringify({ models: [{ name: config.llm.model }] }));
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          questions.push(JSON.parse(body).messages.at(-1).content);
          if (rejected) {
            res.writeHead(status);
            res.end('SECRET_SERVER_ERROR');
            return;
          }
          res.end(
            provider === 'ollama'
              ? '{"message":{"content":"SECRET_ANSWER"},"done":true}\n'
              : 'data: {"choices":[{"index":0,"delta":{"content":"SECRET_ANSWER"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          );
        });
      });
      backend.listen(0, '127.0.0.1');
      await once(backend, 'listening');
      const address = backend.address();
      assert.ok(address && typeof address !== 'string');
      config.llm.base_url = `http://127.0.0.1:${address.port}`;
      let indications = 0;
      const spoken: string[] = [];
      const audio = createServer((socket) => {
        socket.once('data', (frame) => {
          const message = parseMessage(frame);
          assert.equal(message.type, 'audio-operation');
          if (message.type !== 'audio-operation') return;
          const op = message.operation;
          if (op.type === 'indicate-failure') indications++;
          if (op.type === 'synthesize') spoken.push(op.text ?? '');
          socket.end(
            encodeMessage({
              version: 1,
              type: 'audio-result',
              operation_id: op.operation_id,
              ...(op.type === 'recognize' ? { text: op.text } : {}),
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
        core.activate();
        await runTurn(core, path, config, 'SECRET_QUESTION');
        assert.equal(
          core.status().capabilities.inference,
          status >= 500 ? 'unavailable' : 'ready',
        );
        assert.equal(core.status().retry_available, true);
        assert.equal(indications, 1);
        assert.deepEqual(spoken, []);
        const terminal = logs.find(
          (line) => line.event === 'inference_terminal',
        );
        assert.equal(terminal?.category, 'http_failure');
        assert.equal(terminal?.http_status, status);
        rejected = false;
        assert.equal(await probeInference(config), true);
        if (status >= 500)
          core.dispatch({
            type: 'capabilities-changed',
            capabilities: { inference: 'ready' },
          });
        assert.deepEqual(
          questions,
          ['SECRET_QUESTION'],
          'readiness recovery cannot replay',
        );
        await runTurn(core, path, config, 'Noch einmal');
        assert.deepEqual(questions, ['SECRET_QUESTION', 'SECRET_QUESTION']);
        assert.deepEqual(spoken, ['SECRET_ANSWER']);
        assert.equal(indications, 1);
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
}
