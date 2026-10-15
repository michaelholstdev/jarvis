import { performance } from 'node:perf_hooks';

// Discard excess diagnostics instead of buffering them. stdout/stderr collectors
// still own disk retention; Jarvis itself never creates a log file.
let windowStarted = performance.now();
let emitted = 0;
export function diagnostic(
  fields: Record<string, string | number | boolean>,
): void {
  const now = performance.now();
  if (now - windowStarted >= 30000) {
    windowStarted = now;
    emitted = 0;
  }
  if (emitted++ >= 100) return;
  console.error(JSON.stringify(fields));
}
