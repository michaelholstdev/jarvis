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
import {
  encodeMessage,
  type Operation,
  parseMessage,
} from '../packages/protocol/index.js';

for (const action of ['stop', 'replace', 'locked', 'muted', 'end'] as const) {
  for (const delivered of [0, 6, 12]) {
    test(
      `${action} at delivery ${delivered} permits only heard context in the next Ollama request`,
      { timeout: 5000 },
      async () => {
        const directory = mkdtempSync(join(tmpdir(), 'jv-delivery-'));
        const path = join(directory, 'audio.sock');
        const config = loadConfig();
        config.llm.mode = 'ollama';
        config.interaction.activation_sound = false;
        const core = createCore({ now: () => 0 }, config);
        core.dispatch({ type: 'audio-ready' });
        core.dispatch({
          type: 'capabilities-changed',
          capabilities: { inference: 'ready' },
        });
        const histories: { role: string; content: string }[][] = [];
        const answer = 'Eins. Zwei. Drei.';
        const ollama = httpServer((req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            histories.push(JSON.parse(body).messages);
            res.end(
              `${JSON.stringify({ message: { content: histories.length === 1 ? 'Alt.' : answer }, done: true })}\n`,
            );
          });
        });
        ollama.listen(0, '127.0.0.1');
        await once(ollama, 'listening');
        const address = ollama.address();
        assert.ok(address && typeof address !== 'string');
        config.llm.base_url = `http://127.0.0.1:${address.port}`;
        const peers = new Set<Socket>();
        let oldPlay: Operation | undefined;
        let oldCancel: Operation | undefined;
        let interrupt = false;
        const audio = createServer((socket) => {
          peers.add(socket);
          socket.on('close', () => peers.delete(socket));
          socket.on('error', () => {});
          socket.once('data', (frame) => {
            const message = parseMessage(frame);
            assert.equal(message.type, 'audio-operation');
            if (message.type !== 'audio-operation') return;
            const op = message.operation;
            if (op.type === 'play' && interrupt) {
              interrupt = false;
              oldPlay = op;
              if (action === 'stop') core.stop();
              else if (action === 'replace') core.activate();
              else if (action === 'end') core.stop();
              else
                core.dispatch({
                  type: 'inhibition-changed',
                  source: action,
                  active: true,
                });
              return;
            }
            if (op.type === 'cancel') {
              oldCancel = op;
              assert.equal(op.target_operation_id, oldPlay?.operation_id);
            }
            socket.end(
              encodeMessage({
                version: 1,
                type: 'audio-result',
                operation_id: op.operation_id,
                ...(op.type === 'recognize' ? { text: op.text } : {}),
                ...([
                  'play',
                  'cancel',
                  'acknowledge',
                  'close-conversation',
                ].includes(op.type)
                  ? {
                      completed: op.type !== 'cancel',
                      delivered_chars:
                        op.type === 'play'
                          ? (op.text?.length ?? 0)
                          : op.type === 'cancel'
                            ? delivered
                            : 0,
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
          await runTurn(core, path, config, 'Vorher?');
          interrupt = true;
          await runTurn(core, path, config, 'Unterbrochen?');
          await runTurn(core, path, config);
          if (action === 'end')
            await runTurn(core, path, config, 'Gespräch beenden');
          if (action === 'locked' || action === 'muted') {
            core.dispatch({
              type: 'inhibition-changed',
              source: action,
              active: false,
            });
            await runTurn(core, path, config);
          }
          if (action === 'locked' || action === 'muted' || action === 'end')
            core.activate();
          const next = core.operations()[0];
          assert.ok(oldPlay);
          // Even successful late completion and repeated cancellation must be inert.
          for (const op of [oldPlay, oldCancel]) {
            if (op)
              core.dispatch({
                type: 'playback-completed',
                operation_id: op.operation_id,
                completed: true,
                delivered_chars: answer.length,
              });
          }
          assert.deepEqual(core.operations()[0], next);
          await runTurn(core, path, config, 'Was habe ich gehört?');
          const retained = action === 'stop' || action === 'replace';
          assert.deepEqual(histories[2]?.slice(1), [
            ...(retained
              ? [
                  { role: 'user', content: 'Vorher?' },
                  { role: 'assistant', content: 'Alt.' },
                ]
              : []),
            ...(retained && delivered
              ? [
                  { role: 'user', content: 'Unterbrochen?' },
                  {
                    role: 'assistant',
                    content: delivered === 6 ? 'Eins. ' : 'Eins. Zwei. ',
                  },
                ]
              : []),
            { role: 'user', content: 'Was habe ich gehört?' },
          ]);
        } finally {
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
  }
}
