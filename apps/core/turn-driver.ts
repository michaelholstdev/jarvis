import { performance } from 'node:perf_hooks';
import type { Message } from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import { audioDeadlineMs } from './audio-deadline.js';
import type { Config } from './config.js';
import type { createCore } from './core.js';
import { diagnostic as logDiagnostic } from './diagnostics.js';
import { generateAnswer } from './ollama.js';
import { operationCapability } from './operation-capability.js';
import { request } from './transport.js';

/** Drives one bounded turn through selected inference and audio adapters. */
export async function runTurn(
  core: ReturnType<typeof createCore>,
  audioPath: string,
  config: Config,
  utterance?: string,
): Promise<void> {
  const perform = async <T>(
    operationId: string,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const watcher = setInterval(() => {
      if (core.operations()[0]?.operation_id !== operationId)
        controller.abort();
    }, 20);
    try {
      return await action(controller.signal);
    } finally {
      clearInterval(watcher);
    }
  };
  // Bound each invocation; the daemon resumes any remaining executable operation.
  for (let step = 0; step < 8; step++) {
    const operation = core.operations()[0];
    if (
      !operation ||
      (operation.type === 'recognize' &&
        utterance === undefined &&
        (config.audio.mode !== 'voice' ||
          (core.status().state !== 'listening' &&
            config.llm.mode !== 'ollama')))
    )
      return;
    logDiagnostic({
      event: 'operation_started',
      operation: operation.type,
      operation_id: operation.operation_id,
      state: core.status().state,
    });
    const capability = operationCapability(operation.type);
    if (
      capability &&
      core.status().capabilities[capability] === 'unavailable'
    ) {
      if (operation.type === 'recognize') utterance = undefined;
      core.dispatch({
        type: 'operation-failed',
        operation_id: operation.operation_id,
        code: 'unavailable',
        capability,
      });
      continue;
    }
    if (operation.type === 'recognize' && utterance !== undefined) {
      core.dispatch({
        type: 'speech-started',
        operation_id: operation.operation_id,
      });
    }
    if (operation.type === 'infer') {
      if (config.llm.mode === 'ollama') {
        try {
          const text = await perform(operation.operation_id, (signal) =>
            generateAnswer(config, operation, signal),
          );
          if (core.operations()[0]?.operation_id !== operation.operation_id)
            return;
          core.dispatch({
            type: 'inferred',
            operation_id: operation.operation_id,
            text,
          });
        } catch (error) {
          if (core.operations()[0]?.operation_id !== operation.operation_id)
            return;
          core.dispatch({
            type: 'operation-failed',
            operation_id: operation.operation_id,
            capability: 'inference',
            code: error instanceof ProtocolError ? error.code : 'unavailable',
          });
        }
        continue;
      }
      const previous = operation.context?.at(-1);
      core.dispatch({
        type: 'inferred',
        operation_id: operation.operation_id,
        text: previous
          ? `Zur vorherigen Frage „${contextExcerpt(previous.question)}“ lautete die simulierte Antwort: ${contextExcerpt(previous.reply)}`
          : 'Dies ist eine simulierte Antwort von Jarvis.',
      });
      continue;
    }
    const audioType = operation.type;
    const startedAt = performance.now();
    let response: Message;
    try {
      response = await perform(operation.operation_id, (signal) =>
        request(
          audioPath,
          'core',
          {
            ...config.transport,
            timeout_ms: audioDeadlineMs(config, operation.type),
          },
          {
            version: 1,
            type: 'audio-operation',
            operation: {
              ...operation,
              type: audioType,
              ...(operation.type === 'recognize' &&
              config.audio.mode !== 'voice'
                ? { text: utterance }
                : {}),
            },
          },
          {
            signal,
            onProgress: (progress) => {
              if (progress.type === 'control-stopped') {
                if (
                  operation.type !== 'play' ||
                  progress.operation_id !== operation.operation_id
                )
                  throw new ProtocolError('invalid_message');
                core.dispatch({
                  type: 'control-recognized',
                  operation_id: progress.operation_id,
                  text: 'Stopp',
                });
                return;
              }
              if (
                operation.type !== 'recognize' ||
                progress.operation_id !== operation.operation_id
              )
                throw new ProtocolError('invalid_message');
              core.dispatch({
                type: 'speech-started',
                operation_id: progress.operation_id,
              });
            },
          },
        ),
      );
    } catch (error) {
      if (core.operations()[0]?.operation_id !== operation.operation_id) return;
      throw error;
    }
    if (core.operations()[0]?.operation_id !== operation.operation_id) return;
    if (response.type === 'error') {
      if (
        operation.type === 'privacy' ||
        operation.type === 'close-conversation'
      )
        throw new ProtocolError(response.code);
      if (operation.type === 'recognize') utterance = undefined;
      logDiagnostic({
        event: 'operation_failed',
        operation: operation.type,
        code: response.code,
      });
      core.dispatch({
        type: 'operation-failed',
        operation_id: operation.operation_id,
        code: response.code,
        capability: operationCapability(operation.type) ?? 'audio',
      });
      continue;
    }
    if (
      response.type !== 'audio-result' ||
      response.operation_id !== operation.operation_id
    )
      throw new ProtocolError('invalid_message');
    switch (operation.type) {
      case 'privacy':
        core.dispatch({
          type: 'privacy-applied',
          operation_id: response.operation_id,
        });
        break;
      case 'recognize':
        if (response.text === undefined)
          throw new ProtocolError('invalid_message');
        core.dispatch({
          type: 'recognized',
          operation_id: response.operation_id,
          text: response.text,
        });
        utterance = undefined;
        break;
      case 'synthesize':
        core.dispatch({
          type: 'synthesized',
          operation_id: response.operation_id,
        });
        break;
      case 'indicate-failure':
      case 'cancel':
      case 'close-conversation':
      case 'acknowledge':
      case 'play':
        if (
          response.completed === undefined ||
          response.delivered_chars === undefined
        )
          throw new ProtocolError('invalid_message');
        core.dispatch({
          type: 'playback-completed',
          operation_id: response.operation_id,
          completed: response.completed,
          delivered_chars: response.delivered_chars,
        });
        logDiagnostic({
          event: 'playback_completed',
          operation_id: response.operation_id,
          completed: response.completed,
          delivered_chars: response.delivered_chars,
          elapsed_ms: Math.max(0, performance.now() - startedAt),
          state: core.status().state,
        });
        break;
    }
    if (
      (operation.type === 'play' || operation.type === 'indicate-failure') &&
      core.operations()[0]?.type === 'recognize'
    )
      return;
  }
}

function contextExcerpt(text: string): string {
  return Array.from(text).slice(0, 80).join('');
}
