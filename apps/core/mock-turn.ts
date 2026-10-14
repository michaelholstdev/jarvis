import { performance } from 'node:perf_hooks';
import type { Message } from '../../packages/protocol/index.js';
import { ProtocolError } from '../../packages/protocol/index.js';
import type { Config } from './config.js';
import type { createCore } from './core.js';
import { request } from './transport.js';

/** Runs mock service operations until listening needs a scripted utterance. */
export async function runMockTurn(
  core: ReturnType<typeof createCore>,
  audioPath: string,
  config: Config,
  utterance?: string,
): Promise<void> {
  for (let step = 0; step < 5; step++) {
    const operation = core.operations()[0];
    if (
      !operation ||
      (operation.type === 'recognize' && utterance === undefined)
    )
      return;
    console.log(
      JSON.stringify({
        event: 'operation_started',
        operation: operation.type,
        operation_id: operation.operation_id,
        state: core.status().state,
      }),
    );
    if (operation.type === 'infer') {
      core.dispatch({
        type: 'inferred',
        operation_id: operation.operation_id,
        text: 'Dies ist eine simulierte Antwort von Jarvis.',
      });
      continue;
    }
    const startedAt = performance.now();
    const response: Message = await request(
      audioPath,
      'core',
      config.transport,
      {
        version: 1,
        type: 'audio-operation',
        operation: {
          ...operation,
          type: operation.type,
          ...(operation.type === 'recognize' ? { text: utterance } : {}),
        },
      },
    );
    if (
      response.type !== 'audio-result' ||
      response.operation_id !== operation.operation_id
    )
      throw new ProtocolError(
        response.type === 'error' ? response.code : 'invalid_message',
      );
    switch (operation.type) {
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
        console.log(
          JSON.stringify({
            event: 'playback_completed',
            operation_id: response.operation_id,
            completed: response.completed,
            delivered_chars: response.delivered_chars,
            elapsed_ms: Math.max(0, performance.now() - startedAt),
            state: core.status().state,
          }),
        );
        break;
    }
  }
}
