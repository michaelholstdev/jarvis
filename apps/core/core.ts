import type {
  Diagnostic,
  HealthStatus,
} from '../../packages/protocol/index.js';

export type ServiceEvent =
  | { type: 'audio-ready' }
  | { type: 'audio-lost'; diagnostic?: Diagnostic };

/** M0 orchestration boundary. Conversation actions arrive in M1/M2. */
export function createCore(clock: { now(): number }) {
  let ready = false;
  let changedAt = clock.now();
  let diagnostic: Diagnostic | null = 'unavailable';
  return {
    dispatch(event: ServiceEvent): void {
      const next = event.type === 'audio-ready';
      if (next !== ready) changedAt = clock.now();
      ready = next;
      diagnostic =
        event.type === 'audio-lost'
          ? (event.diagnostic ?? 'unavailable')
          : null;
    },
    status(): HealthStatus {
      return {
        ready,
        mode: 'mock' as const,
        state: 'idle' as const,
        manual_activation: 'unavailable' as const,
        voice_conversation: 'unavailable' as const,
        audio: ready ? ('ready' as const) : ('unavailable' as const),
        audio_diagnostic: diagnostic,
        since_ms: Math.max(0, clock.now() - changedAt),
      };
    },
    operations(): readonly unknown[] {
      return [];
    },
  };
}
