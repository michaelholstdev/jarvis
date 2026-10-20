import { performance } from 'node:perf_hooks';
import type { Operation } from '../../packages/protocol/index.js';
import type { Config } from './config.js';
import { diagnostic } from './diagnostics.js';
import {
  inferenceFailure,
  inferenceObservation,
} from './inference-diagnostic.js';
import * as llamaCpp from './llama-cpp.js';
import * as ollama from './ollama.js';

const readiness = new WeakMap<Config, llamaCpp.InferenceReadiness>();

/** Backend selection stays outside the conversation state machine. */
export async function generateAnswer(
  config: Config,
  operation: Operation,
  signal: AbortSignal,
  context?: {
    turn_id: string;
    interruption(): 'timeout' | 'cancelled' | undefined;
  },
): Promise<string> {
  const started = performance.now();
  const observation = inferenceObservation();
  let outcome = 'success';
  let category = 'none';
  try {
    const adapter = config.llm.provider === 'llama.cpp' ? llamaCpp : ollama;
    return await adapter.generateAnswer(config, operation, signal, observation);
  } catch (error) {
    outcome = signal.aborted ? 'cancelled' : 'failure';
    category = signal.aborted ? 'cancelled' : inferenceFailure(error);
    throw error;
  } finally {
    // Consult the synchronous core disposition as well as the polled HTTP abort.
    // A watchdog is a failure; a superseded successful response is cancelled.
    const interruption = context?.interruption();
    if (interruption) {
      outcome = interruption === 'timeout' ? 'failure' : 'cancelled';
      category = interruption;
    }
    diagnostic({
      event: 'inference_terminal',
      turn_id: context?.turn_id ?? 'unknown',
      operation_id: operation.operation_id,
      backend: config.llm.provider,
      model: config.llm.model.slice(0, 128),
      generation_limit: config.llm.num_predict,
      ...observation.fields,
      elapsed_ms: performance.now() - started,
      outcome,
      category,
    });
  }
}

export async function probeInference(config: Config): Promise<boolean> {
  if (config.llm.provider !== 'llama.cpp') return ollama.probeInference(config);
  const status = await llamaCpp.probeInferenceStatus(config);
  if (readiness.get(config) !== status) {
    readiness.set(config, status);
    diagnostic({ event: 'inference_readiness', status });
  }
  return status === 'ready';
}
