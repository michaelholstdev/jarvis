import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';

async function fixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = loadConfig();
  Object.assign(config.llm, {
    mode: 'llama.cpp',
    provider: 'llama.cpp',
    model: 'local-alias',
    base_url: `http://127.0.0.1:${address.port}`,
  });
  return {
    config,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
const operation = {
  type: 'infer' as const,
  operation_id: '1',
  text: 'Und wo?',
  context: [{ question: 'Welche Stadt?', reply: 'Berlin.' }],
};
const event = (content: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\r\n\r\n`;

test('llama.cpp streams only assistant content across arbitrary UTF-8 and SSE chunks with context and options', async () => {
  const { generateAnswer } = await import('../apps/core/llama-cpp.js');
  let body = '';
  const f = await fixture((req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const stream =
        ': heartbeat\r\n\r\ndata: {"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"private"},"finish_reason":null}]}\r\n\r\n' +
        event('Grüße aus ') +
        event('Berlin.', 'stop') +
        'data: [DONE]\r\n\r\n';
      const bytes = Buffer.from(stream);
      // Split every byte, including UTF-8 and CRLF boundaries, into separate writes.
      let i = 0;
      const send = () => {
        if (i < bytes.length) {
          res.write(bytes.subarray(i, ++i));
          setImmediate(send);
        } else res.end();
      };
      send();
    });
  });
  try {
    assert.equal(
      await generateAnswer(f.config, operation, new AbortController().signal),
      'Grüße aus Berlin.',
    );
    const sent = JSON.parse(body);
    assert.match(sent.messages[0].content, /Deutsch/);
    assert.deepEqual(sent.messages.slice(1), [
      { role: 'user', content: 'Welche Stadt?' },
      { role: 'assistant', content: 'Berlin.' },
      { role: 'user', content: 'Und wo?' },
    ]);
    assert.equal(sent.model, 'local-alias');
    assert.equal(sent.max_tokens, 512);
    assert.equal(sent.temperature, 0.3);
    assert.equal(sent.seed, 0);
    assert.equal(sent.tools, undefined);
    assert.equal(sent.options, undefined);
    assert.equal(sent.num_ctx, undefined);
  } finally {
    await f.close();
  }
});

for (const [name, stream] of [
  ['malformed JSON', 'data: private broken JSON\n\n'],
  ['empty answer', `${event('', 'stop')}data: [DONE]\n\n`],
  ['missing terminal event', event('partial')],
  ['missing finish reason', `${event('partial')}data: [DONE]\n\n`],
  [
    'tool call',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"function":{"name":"private"}}]},"finish_reason":null}]}\n\n',
  ],
  [
    'function call',
    'data: {"choices":[{"index":0,"delta":{"function_call":{"name":"private"}},"finish_reason":null}]}\n\n',
  ],
  ['tool finish', `${event('partial', 'tool_calls')}data: [DONE]\n\n`],
  ['error event', 'event: error\ndata: {"message":"private detail"}\n\n'],
  ['error payload', 'data: {"error":{"message":"private detail"}}\n\n'],
  [
    'reasoning in content',
    `${event('<think>private</think>answer', 'stop')}data: [DONE]\n\n`,
  ],
  ['oversized answer', `${event('x'.repeat(5000), 'stop')}data: [DONE]\n\n`],
  ['oversized wire response', `: ${'x'.repeat(1048577)}`],
  [
    'content after finish',
    `${event('first', 'stop') + event('second')}data: [DONE]\n\n`,
  ],
] as const) {
  test(`llama.cpp rejects ${name} without returning partial speech or content diagnostics`, async () => {
    const { generateAnswer } = await import('../apps/core/llama-cpp.js');
    const f = await fixture((_req, res) => res.end(stream));
    try {
      await assert.rejects(
        generateAnswer(f.config, operation, new AbortController().signal),
        /^(Error: )?(invalid_message|frame_too_large)$/,
      );
    } finally {
      await f.close();
    }
  });
}

test('SSE accepts multiline data, bare CR/LF delimiters, usage and length completion, and closes at DONE', async () => {
  const { generateAnswer } = await import('../apps/core/llama-cpp.js');
  const f = await fixture((_req, res) => {
    res.write(
      'data: {"choices": [\rdata: {"index":0,"delta":{"content":"Kurz."},"finish_reason":"length"}]}\r\r',
    );
    res.write(
      'data: {"choices":[],"usage":{"completion_tokens":5}}\n\ndata: [DONE]\n\n',
    );
    // Deliberately keep HTTP open; DONE terminates generation.
  });
  try {
    assert.equal(
      await generateAnswer(f.config, operation, new AbortController().signal),
      'Kurz.',
    );
  } finally {
    await f.close();
  }
});

for (const failure of ['timeout', 'abort', 'http', 'redirect'] as const) {
  test(`llama.cpp bounds ${failure} and closes the generation connection`, async () => {
    const { generateAnswer } = await import('../apps/core/llama-cpp.js');
    let started = () => {};
    const received = new Promise<void>((resolve) => {
      started = resolve;
    });
    let closed = () => {};
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const f = await fixture((_req, res) => {
      res.once('close', closed);
      if (failure === 'http' || failure === 'redirect') {
        res.writeHead(failure === 'http' ? 503 : 302, {
          Location: 'https://example.com',
        });
        res.end('private server detail');
      } else res.write(event('partial'));
      started();
    });
    f.config.llm.timeout_ms = 100;
    const controller = new AbortController();
    try {
      const result = generateAnswer(f.config, operation, controller.signal);
      const rejected = assert.rejects(
        result,
        failure === 'timeout' ? /timeout/ : /unavailable/,
      );
      await received;
      if (failure === 'abort') controller.abort();
      await rejected;
      await disconnected;
    } finally {
      await f.close();
    }
  });
}

for (const state of [
  'ready',
  'loading',
  'missing-model',
  'unavailable',
  'timeout',
  'redirect',
  'oversized',
  'malformed',
] as const) {
  test(`non-generating readiness distinguishes ${state}`, async () => {
    const { probeInferenceStatus } = await import('../apps/core/llama-cpp.js');
    const paths: string[] = [];
    const f = await fixture((req, res) => {
      assert.equal(req.method, 'GET');
      paths.push(req.url ?? '');
      if (state === 'timeout') {
        res.write(' ');
        return;
      }
      if (state === 'redirect') {
        res.writeHead(302, { Location: 'https://example.com' });
        res.end();
        return;
      }
      if (state === 'oversized') {
        res.end('x'.repeat(1048577));
        return;
      }
      if (state === 'malformed') {
        res.end('private detail');
        return;
      }
      if (req.url === '/health') {
        if (state === 'loading') {
          res.writeHead(503);
          res.end(
            JSON.stringify({
              error: {
                code: 503,
                message: 'Loading model',
                type: 'unavailable_error',
              },
            }),
          );
        } else if (state === 'unavailable') {
          res.writeHead(500);
          res.end('private');
        } else res.end('{"status":"ok"}');
      } else if (req.url === '/v1/models')
        res.end(
          JSON.stringify(
            {
              data: [
                {
                  id: state === 'missing-model' ? 'other-model' : 'local-alias',
                },
              ],
            },
            null,
            2,
          ),
        );
      else assert.fail('probe attempted a generating endpoint');
    });
    f.config.transport.timeout_ms = 100;
    try {
      assert.equal(
        await probeInferenceStatus(f.config),
        ['timeout', 'redirect', 'oversized', 'malformed'].includes(state)
          ? 'unavailable'
          : state,
      );
      assert.ok(paths.length <= 2);
    } finally {
      await f.close();
    }
  });
}

test('terminal bare CR closes generation immediately even without HTTP EOF', async () => {
  const { generateAnswer } = await import('../apps/core/llama-cpp.js');
  const f = await fixture((_req, res) => {
    res.write(`${event('Fertig.', 'stop')}data: [DONE]\r\r`);
  });
  f.config.llm.timeout_ms = 100;
  try {
    assert.equal(
      await generateAnswer(f.config, operation, new AbortController().signal),
      'Fertig.',
    );
  } finally {
    await f.close();
  }
});

test('inference readiness logs transitions once per configuration, including recovery', async () => {
  const { probeInference } = await import('../apps/core/inference.js');
  let status = 'loading';
  const f = await fixture((req, res) => {
    if (req.url === '/health') {
      if (status === 'loading') {
        res.writeHead(503);
        res.end(
          JSON.stringify({
            error: {
              code: 503,
              type: 'unavailable_error',
              message: 'Loading model',
            },
          }),
        );
      } else if (status === 'unavailable') {
        res.writeHead(500);
        res.end('private server detail');
      } else res.end('{"status":"ok"}');
    } else {
      assert.equal(req.url, '/v1/models');
      res.end(
        JSON.stringify({
          data: [
            { id: status === 'missing-model' ? 'other-model' : 'local-alias' },
          ],
        }),
      );
    }
  });
  const diagnostics: Record<string, unknown>[] = [];
  const originalError = console.error;
  console.error = (line: string) => diagnostics.push(JSON.parse(line));
  try {
    for (status of [
      'loading',
      'loading',
      'missing-model',
      'missing-model',
      'ready',
      'ready',
      'unavailable',
      'unavailable',
      'ready',
      'ready',
    ]) {
      assert.equal(await probeInference(f.config), status === 'ready');
    }
    assert.deepEqual(
      diagnostics.map(({ event, status }) => ({ event, status })),
      [
        { event: 'inference_readiness', status: 'loading' },
        { event: 'inference_readiness', status: 'missing-model' },
        { event: 'inference_readiness', status: 'ready' },
        { event: 'inference_readiness', status: 'unavailable' },
        { event: 'inference_readiness', status: 'ready' },
      ],
    );
    assert.equal(
      await probeInference({ ...f.config, llm: { ...f.config.llm } }),
      true,
    );
    assert.equal(
      diagnostics.length,
      6,
      'a separate configuration reports its initial status',
    );
    assert.doesNotMatch(
      JSON.stringify(diagnostics),
      /private server detail|local-alias|other-model/,
    );
  } finally {
    console.error = originalError;
    await f.close();
  }
});
