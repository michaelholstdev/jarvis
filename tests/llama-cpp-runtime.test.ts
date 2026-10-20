import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { runTurn } from '../apps/core/turn-driver.js';

for (const control of ['replacement', 'stop', 'locked', 'muted'] as const) {
  test(
    `${control} cancels llama.cpp HTTP generation and cannot deliver stale output`,
    { timeout: 2000 },
    async () => {
      let received = () => {};
      const started = new Promise<void>((resolve) => {
        received = resolve;
      });
      let closed = () => {};
      const disconnected = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const server = createServer((_req, res) => {
        res.once('close', closed);
        res.write(
          'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        );
        received();
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const config = loadConfig();
      Object.assign(config.llm, {
        mode: 'llama.cpp',
        provider: 'llama.cpp',
        base_url: `http://127.0.0.1:${address.port}`,
      });
      config.interaction.activation_sound = false;
      const core = createCore({ now: () => 0 }, config);
      core.dispatch({ type: 'audio-ready' });
      core.dispatch({
        type: 'capabilities-changed',
        capabilities: { inference: 'ready' },
      });
      core.activate();
      core.dispatch({
        type: 'recognized',
        operation_id: core.operations()[0]?.operation_id ?? '',
        text: 'Frage',
      });
      const infer = core.operations()[0];
      assert.equal(infer?.type, 'infer');
      const turn = runTurn(core, '/unused/audio.sock', config);
      try {
        await started;
        if (control === 'replacement') core.activate();
        else if (control === 'stop') core.stop();
        else
          core.dispatch({
            type: 'inhibition-changed',
            source: control,
            active: true,
          });
        const current = core.operations()[0];
        assert.notEqual(current?.operation_id, infer?.operation_id);
        await turn;
        await disconnected;
        // A late result cannot replace cancellation or privacy cleanup.
        core.dispatch({
          type: 'inferred',
          operation_id: infer?.operation_id ?? '',
          text: 'stale',
        });
        assert.deepEqual(core.operations()[0], current);
        assert.equal(core.reply(), null);
      } finally {
        server.closeAllConnections();
        await turn.catch(() => {});
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
}
