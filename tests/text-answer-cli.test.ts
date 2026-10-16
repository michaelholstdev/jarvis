import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  encodeMessage,
  type Message,
  parseMessage,
} from '../packages/protocol/index.js';

for (const failure of ['closed', 'changed', 'no-progress'] as const) {
  test(
    `CLI discards partial text on ${failure} continuation`,
    { timeout: 5000 },
    async () => {
      const runtime = mkdtempSync(join(tmpdir(), 'jv-text-cli-'));
      mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
      const configPath = join(runtime, 'config.json');
      writeFileSync(configPath, '{}');
      let requests = 0;
      const server = createServer((socket) => {
        socket.on('error', () => {});
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk;
          if (!data.includes('\n')) return;
          const query = parseMessage(Buffer.from(data.trim()));
          assert.equal(query.type, 'text-answer-request');
          assert.ok(query.type === 'text-answer-request');
          requests++;
          let response: Message;
          if (requests === 1) {
            assert.equal(query.offset, 0);
            response = {
              version: 1,
              type: 'text-answer',
              text: 'PRIVATE_PARTIAL',
              answer_id: 'first',
              next_offset: 15,
            };
          } else {
            assert.equal(query.answer_id, 'first');
            assert.equal(query.offset, 15);
            response =
              failure === 'closed'
                ? { version: 1, type: 'error', code: 'unavailable' }
                : {
                    version: 1,
                    type: 'text-answer',
                    text: 'PRIVATE_REMAINDER',
                    answer_id: failure === 'changed' ? 'second' : 'first',
                    next_offset: failure === 'no-progress' ? 15 : null,
                  };
          }
          socket.end(encodeMessage(response));
        });
      });
      server.listen(join(runtime, 'jarvis/core.sock'));
      await once(server, 'listening');
      try {
        const child = spawn('node', ['dist/apps/core/main.js', 'text'], {
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: runtime,
            JARVIS_CONFIG: configPath,
          },
        });
        let output = '';
        let errors = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          errors += chunk;
        });
        const [code] = await once(child, 'exit');
        assert.equal(code, 1);
        assert.equal(requests, 2);
        assert.equal(output, '');
        assert.doesNotMatch(errors, /PRIVATE|first|second/);
        assert.match(errors, /unavailable|invalid_message/);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(runtime, { recursive: true });
      }
    },
  );
}
