import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';
import { generateAnswer } from '../apps/core/inference.js';

const event = (content: string, reasoning: string, finish: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content, reasoning_content: reasoning }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 512, total_tokens: 524 } })}\n\ndata: [DONE]\n\n`;

for (const [name, stream, outcome, category] of [
  ['empty', event('', '', 'stop'), 'failure', 'empty_answer'],
  [
    'reasoning only at limit',
    event('', 'SECRET_REASONING', 'length'),
    'failure',
    'empty_answer',
  ],
  ['usable at limit', event('SECRET_ANSWER', '', 'length'), 'success', 'none'],
  [
    'incomplete',
    'data: {"choices":[{"index":0,"delta":{"content":"SECRET_ANSWER"}}]}\n\n',
    'failure',
    'incomplete_stream',
  ],
  ['malformed', 'data: SECRET_BODY\n\n', 'failure', 'malformed_stream'],
  [
    'unsupported',
    event('', '', 'SECRET_FINISH'),
    'failure',
    'unsupported_response',
  ],
] as const) {
  test(`terminal inference diagnostic: ${name}`, async () => {
    const server = createServer((_req, res) => res.end(stream));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = loadConfig();
    Object.assign(config.llm, {
      provider: 'llama.cpp',
      base_url: `http://127.0.0.1:${address.port}`,
    });
    const logs: Record<string, unknown>[] = [];
    const original = console.error;
    console.error = (line: string) => logs.push(JSON.parse(line));
    try {
      const answer = generateAnswer(
        config,
        { type: 'infer', operation_id: '42', text: 'SECRET_PROMPT' },
        new AbortController().signal,
      );
      if (outcome === 'success') assert.equal(await answer, 'SECRET_ANSWER');
      else await assert.rejects(answer);
      const terminal = logs.filter(
        (line) => line.event === 'inference_terminal',
      );
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0]?.operation_id, '42');
      assert.equal(terminal[0]?.outcome, outcome);
      assert.equal(terminal[0]?.category, category);
      assert.equal(terminal[0]?.generation_limit, 512);
      assert.equal(typeof terminal[0]?.elapsed_ms, 'number');
      if (name === 'reasoning only at limit') {
        assert.equal(terminal[0]?.reasoning_chars, 16);
        assert.equal(terminal[0]?.answer_chars, 0);
        assert.equal(terminal[0]?.completion_tokens, 512);
        assert.equal(terminal[0]?.finish_reason, 'length');
      }
      assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
    } finally {
      console.error = original;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

for (const [name, expected] of [
  ['timeout', 'timeout'],
  ['HTTP', 'http_failure'],
  ['reset', 'incomplete_stream'],
  ['cancel', 'cancelled'],
  ['oversized', 'output_size_limit'],
  ['connection', 'connection_failure'],
] as const) {
  test(`terminal transport diagnostic: ${name}`, async () => {
    let started = () => {};
    const received = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = createServer((_req, res) => {
      if (name === 'HTTP') {
        res.writeHead(503);
        res.end('SECRET_ERROR');
      } else if (name === 'oversized')
        res.end(event('x'.repeat(5000), '', 'stop'));
      else {
        res.write(': activity\n\n');
        if (name === 'reset') setImmediate(() => res.destroy());
      }
      started();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = loadConfig();
    Object.assign(config.llm, {
      provider: 'llama.cpp',
      timeout_ms: 50,
      base_url: `http://127.0.0.1:${address.port}`,
    });
    if (name === 'connection')
      await new Promise<void>((resolve) => server.close(() => resolve()));
    const logs: Record<string, unknown>[] = [];
    const original = console.error;
    console.error = (line: string) => logs.push(JSON.parse(line));
    const controller = new AbortController();
    try {
      const result = generateAnswer(
        config,
        { type: 'infer', operation_id: 'transport' },
        controller.signal,
      );
      const rejected = assert.rejects(result);
      if (name === 'cancel') {
        await received;
        controller.abort();
      }
      await rejected;
      const terminal = logs.filter(
        (line) => line.event === 'inference_terminal',
      );
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0]?.category, expected);
      assert.equal(
        terminal[0]?.outcome,
        name === 'cancel' ? 'cancelled' : 'failure',
      );
      assert.equal(
        terminal[0]?.completion_tokens,
        name === 'oversized' ? 512 : 'unknown',
      );
      assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
    } finally {
      console.error = original;
      server.closeAllConnections();
      if (name !== 'connection')
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

for (const provider of ['llama.cpp', 'ollama']) {
  for (const includeContent of [true, false]) {
    test(`${provider} preserves metadata on unsupported tool output ${includeContent ? 'with' : 'without'} content`, async () => {
      const message = {
        tool_calls: [
          { function: { name: 'SECRET_TOOL', arguments: 'SECRET_ARGUMENTS' } },
        ],
        ...(includeContent ? { content: 'SECRET_ANSWER' } : {}),
        ...(provider === 'ollama'
          ? { thinking: 'SECRET_REASONING' }
          : { reasoning_content: 'SECRET_REASONING' }),
      };
      const payload =
        provider === 'ollama'
          ? `${JSON.stringify({ message, done: true, done_reason: 'tool_calls', prompt_eval_count: 11, eval_count: 7 })}\n`
          : `data: ${JSON.stringify({ choices: [{ index: 0, delta: message, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } })}\n\ndata: [DONE]\n\n`;
      const server = createServer((_req, res) => res.end(payload));
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const config = loadConfig();
      Object.assign(config.llm, {
        provider,
        base_url: `http://127.0.0.1:${address.port}`,
      });
      const logs: Record<string, unknown>[] = [];
      const original = console.error;
      console.error = (line: string) => logs.push(JSON.parse(line));
      try {
        await assert.rejects(
          generateAnswer(
            config,
            { type: 'infer', operation_id: 'tool', text: 'SECRET_PROMPT' },
            new AbortController().signal,
          ),
        );
        const terminal = logs.filter(
          (line) => line.event === 'inference_terminal',
        );
        assert.equal(terminal.length, 1);
        assert.equal(terminal[0]?.outcome, 'failure');
        assert.equal(terminal[0]?.category, 'unsupported_response');
        assert.equal(terminal[0]?.finish_reason, 'tool_calls');
        assert.equal(terminal[0]?.prompt_tokens, 11);
        assert.equal(terminal[0]?.completion_tokens, 7);
        assert.equal(
          terminal[0]?.total_tokens,
          provider === 'ollama' ? 'unknown' : 18,
        );
        assert.equal(terminal[0]?.answer_chars, includeContent ? 13 : 0);
        assert.equal(terminal[0]?.reasoning_chars, 16);
        assert.doesNotMatch(JSON.stringify(logs), /SECRET/);
      } finally {
        console.error = original;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}
