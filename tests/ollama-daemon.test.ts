import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { request } from '../apps/core/transport.js';
import { encodeMessage, type Message } from '../packages/protocol/index.js';

for (const provider of ['ollama', 'llama.cpp']) {
  for (const [reactivate, activationSound, emptyResults, turns] of [
    [false, true, 0, 2],
    [false, true, 0, 30],
    [true, true, 0, 2],
    [true, false, 0, 2],
    [false, true, 5, 2],
    [false, true, 6, 2],
    [false, true, 7, 2],
    [false, true, 8, 2],
  ] as const) {
    test(
      `${provider} voice daemon contextual follow-ups and spoken end, manual reactivation=${reactivate}, cue=${activationSound}, noise=${emptyResults}, turns=${turns}`,
      { timeout: 10000 },
      async () => {
        const runtime = mkdtempSync(join(tmpdir(), 'jv-voice-'));
        mkdirSync(join(runtime, 'jarvis'), { mode: 0o700 });
        let installed = false;
        let generations = 0;
        const histories: { role: string; content: string }[][] = [];
        const ollama = createHttpServer((req, res) => {
          if (req.url === '/health') {
            res.end('{"status":"ok"}');
            return;
          }
          if (req.url === '/v1/models') {
            res.end(
              JSON.stringify({ data: installed ? [{ id: 'test:local' }] : [] }),
            );
            return;
          }
          if (req.url === '/api/tags') {
            res.end(
              JSON.stringify({
                models: installed ? [{ name: 'test:local' }] : [],
              }),
            );
            return;
          }
          generations++;
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            histories.push(JSON.parse(body).messages);
            res.end(
              provider === 'ollama'
                ? '{"message":{"content":"Eine private Antwort."},"done":true}\n'
                : 'data: {"choices":[{"index":0,"delta":{"content":"Eine private Antwort."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            );
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
            audio: { mode: 'voice' },
            interaction: { activation_sound: activationSound },
            llm: {
              mode: provider,
              provider,
              base_url: `http://127.0.0.1:${address.port}`,
              model: 'test:local',
            },
            recovery: { probe_interval_ms: 500 },
          }),
        );
        const peers = new Set<Socket>();
        let recognitions = 0;
        const transcripts = [
          'Private Frage',
          ...Array<string>(emptyResults).fill(''),
          'Private Folgefrage',
          ...Array.from(
            { length: turns - 2 },
            (_, i) => `Private Folgefrage ${i + 3}`,
          ),
          'Gespräch beenden',
        ];
        let transcriptIndex = 0;
        let plays = 0;
        let capturing = false;
        let overlappingAudio = false;
        let followUp = () => {};
        const followUpStarted = new Promise<void>((resolve) => {
          followUp = resolve;
        });
        const audio = createServer((socket) => {
          peers.add(socket);
          socket.on('close', () => peers.delete(socket));
          socket.on('error', () => {});
          socket.on('data', (frame) => {
            const message = JSON.parse(frame.toString());
            if (message.type === 'hello') {
              socket.end(
                encodeMessage({
                  version: 1,
                  type: 'ready',
                  service: 'audio',
                  mode: 'voice',
                  capabilities: { stt: 'ready', tts: 'ready' },
                }),
              );
              return;
            }
            const op = message.operation;
            if (op.type === 'cancel') capturing = false;
            if (capturing && op.type !== 'cancel') {
              overlappingAudio = true;
              socket.end(
                encodeMessage({ version: 1, type: 'error', code: 'busy' }),
              );
              return;
            }
            if (op.type === 'play') plays++;
            let transcript = '';
            if (op.type === 'recognize') {
              recognitions++;
              if (reactivate && recognitions === 2) {
                capturing = true;
                followUp();
                return;
              }
              transcript = transcripts[transcriptIndex++] ?? '';
              // Progress and final may arrive together in a single socket read.
              socket.write(
                `${JSON.stringify({
                  version: 1,
                  type: 'speech-started',
                  operation_id: op.operation_id,
                })}\n`,
              );
            }
            socket.end(
              encodeMessage({
                version: 1,
                type: 'audio-result',
                operation_id: op.operation_id,
                ...(op.type === 'recognize'
                  ? {
                      text: transcript,
                    }
                  : {}),
                ...([
                  'play',
                  'acknowledge',
                  'close-conversation',
                  'cancel',
                  'indicate-failure',
                ].includes(op.type)
                  ? {
                      completed: op.type !== 'cancel',
                      delivered_chars: op.type === 'play' ? op.text.length : 0,
                    }
                  : {}),
              }),
            );
          });
        });
        audio.listen(join(runtime, 'jarvis/audio.sock'));
        await once(audio, 'listening');
        const daemon = spawn('node', ['dist/apps/core/main.js', 'start'], {
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: runtime,
            JARVIS_CONFIG: configPath,
          },
        });
        let logs = '';
        daemon.stdout.on('data', (chunk) => {
          logs += chunk;
        });
        daemon.stderr.on('data', (chunk) => {
          logs += chunk;
        });
        const send = (message?: Message) =>
          request(
            join(runtime, 'jarvis/core.sock'),
            'cli',
            { timeout_ms: 2000, max_frame_bytes: 8192, max_connections: 8 },
            message,
          );
        const status = async () => {
          const result = await send();
          assert.ok(result.type === 'ready' && result.service === 'core');
          return result.status;
        };
        try {
          await once(daemon.stdout, 'data');
          assert.equal((await status()).capabilities.inference, 'unavailable');
          assert.equal((await status()).manual_activation, 'ready');
          assert.equal(generations, 0);
          installed = true;
          for (
            let count = 0;
            count < 100 && (await status()).capabilities.inference !== 'ready';
            count++
          )
            await setTimeout(10);
          assert.equal((await status()).voice_conversation, 'ready');
          await send({ version: 1, type: 'activate' });
          if (reactivate) {
            await followUpStarted;
            await send({ version: 1, type: 'activate' });
          }
          for (
            let count = 0;
            count < 800 &&
            (recognitions < turns + 1 + Number(reactivate) + emptyResults ||
              (await status()).state !== 'idle');
            count++
          )
            await setTimeout(10);
          assert.equal(
            overlappingAudio,
            false,
            'cancel must complete before new audio starts',
          );
          assert.equal(
            recognitions,
            turns + 1 + Number(reactivate) + emptyResults,
          );
          assert.equal(plays, turns);
          assert.equal(generations, turns);
          assert.equal((await status()).state, 'idle');
          assert.deepEqual(histories[1]?.slice(1), [
            { role: 'user', content: 'Private Frage' },
            { role: 'assistant', content: 'Eine private Antwort.' },
            { role: 'user', content: 'Private Folgefrage' },
          ]);
          assert.equal(histories.length, turns);
          for (let i = 1; i < turns; i++) {
            assert.equal(
              histories[i]?.at(-2)?.content,
              'Eine private Antwort.',
            );
            assert.equal(
              histories[i]?.at(-3)?.content,
              i === 1
                ? 'Private Frage'
                : i === 2
                  ? 'Private Folgefrage'
                  : `Private Folgefrage ${i}`,
            );
          }
          const text = await send({
            version: 1,
            type: 'text-answer-request',
            offset: 0,
          });
          assert.ok(text.type === 'text-answer' && text.text === null);
          assert.doesNotMatch(
            logs,
            /Private Frage|Private Folgefrage|Eine private Antwort|Gespräch beenden/,
          );
        } finally {
          daemon.kill('SIGTERM');
          await once(daemon, 'exit');
          for (const socket of peers) socket.destroy();
          ollama.closeAllConnections();
          await Promise.all([
            new Promise<void>((resolve) => audio.close(() => resolve())),
            new Promise<void>((resolve) => ollama.close(() => resolve())),
          ]);
          rmSync(runtime, { recursive: true });
        }
      },
    );
  }
}
