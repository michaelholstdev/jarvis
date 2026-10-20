import type { Operation } from '../../packages/protocol/index.js';
import type { Config } from './config.js';
import { diagnostic } from './diagnostics.js';
import * as llamaCpp from './llama-cpp.js';
import * as ollama from './ollama.js';

const readiness = new WeakMap<Config, llamaCpp.InferenceReadiness>();

/** Backend selection stays outside the conversation state machine. */
export function generateAnswer(
  config: Config,
  operation: Operation,
  signal: AbortSignal,
): Promise<string> {
  return config.llm.provider === 'llama.cpp'
    ? llamaCpp.generateAnswer(config, operation, signal)
    : ollama.generateAnswer(config, operation, signal);
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
