import type { Capability, Operation } from '../../packages/protocol/index.js';

/** Capability required by an adapter operation; controls use the audio boundary. */
export function operationCapability(
  type: Operation['type'],
): Capability | undefined {
  switch (type) {
    case 'wake':
      return 'wake';
    case 'infer':
      return 'inference';
    case 'recognize':
      return 'stt';
    case 'synthesize':
      return 'tts';
    default:
      return undefined;
  }
}
