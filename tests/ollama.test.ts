import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { generateAnswer } from '../apps/core/ollama.js';

async function fixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = loadConfig();
  config.llm.mode = 'ollama';
  config.llm.model = 'local-model:exact';
  config.llm.base_url = `http://127.0.0.1:${address.port}`;
  return {
    config,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test('Ollama streams a complete German answer with allowed context and configured options', async () => {
  let body = '';
  const f = await fixture((req, res) => {
    assert.equal(req.url, '/api/chat');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.write('{"message":{"content":"Grüße "},"done":false}\n');
      res.end('{"message":{"content":"aus Berlin."},"done":true}\n');
    });
  });
  try {
    assert.equal(
      await generateAnswer(
        f.config,
        {
          type: 'infer',
          operation_id: '1',
          text: 'Und wo?',
          context: [{ question: 'Welche Stadt?', reply: 'Berlin.' }],
        },
        new AbortController().signal,
      ),
      'Grüße aus Berlin.',
    );
    const request = JSON.parse(body);
    assert.equal(request.model, 'local-model:exact');
    assert.equal(request.stream, true);
    assert.deepEqual(request.messages.slice(1), [
      { role: 'user', content: 'Welche Stadt?' },
      { role: 'assistant', content: 'Berlin.' },
      { role: 'user', content: 'Und wo?' },
    ]);
    assert.deepEqual(request.options, {
      num_ctx: 8192,
      num_predict: 512,
      temperature: 0.3,
      seed: 0,
    });
    assert.equal(request.tools, undefined);
  } finally {
    await f.close();
  }
});

for (const failure of [
  'http',
  'malformed',
  'incomplete',
  'empty',
  'oversized',
  'timeout',
  'redirect',
] as const) {
  test(`Ollama rejects ${failure} without returning partial speech`, async () => {
    const f = await fixture((_req, res) => {
      if (failure === 'http') {
        res.writeHead(503);
        res.end('private server detail');
      } else if (failure === 'redirect') {
        res.writeHead(302, { Location: 'https://example.com' });
        res.end();
      } else if (failure === 'malformed') res.end('private broken json\n');
      else if (failure === 'timeout')
        res.write('{"message":{"content":"partial"},"done":false}\n');
      else
        res.end(
          `${JSON.stringify({
            message: {
              content:
                failure === 'empty'
                  ? ''
                  : failure === 'oversized'
                    ? 'x'.repeat(5000)
                    : 'partial',
            },
            done: failure !== 'incomplete',
          })}\n`,
        );
    });
    f.config.llm.timeout_ms = 100;
    try {
      await assert.rejects(
        generateAnswer(
          f.config,
          { type: 'infer', operation_id: '1', text: 'private' },
          new AbortController().signal,
        ),
        (error: Error) => {
          assert.match(
            error.message,
            /^(unavailable|invalid_message|frame_too_large|timeout)$/,
          );
          return true;
        },
      );
    } finally {
      await f.close();
    }
  });
}

test('aborting generation closes the HTTP stream and discards partial output', async () => {
  let received = () => {};
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  let closed = () => {};
  const disconnected = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const f = await fixture((_req, res) => {
    res.on('close', closed);
    res.write('{"message":{"content":"partial"},"done":false}\n');
    received();
  });
  try {
    const controller = new AbortController();
    const result = generateAnswer(
      f.config,
      { type: 'infer', operation_id: '1', text: 'private' },
      controller.signal,
    );
    await started;
    controller.abort();
    await assert.rejects(result, /unavailable/);
    await disconnected;
  } finally {
    await f.close();
  }
});

test('inference probe accepts ordinary formatted JSON and finds only the selected installed model', async () => {
  const { probeInference } = await import('../apps/core/ollama.js');
  const f = await fixture((_req, res) =>
    res.end(
      JSON.stringify({ models: [{ name: 'local-model:exact' }] }, null, 2),
    ),
  );
  try {
    assert.equal(await probeInference(f.config), true);
  } finally {
    await f.close();
  }
});
