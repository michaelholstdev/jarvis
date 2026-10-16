import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Inhibitions } from '../../packages/protocol/index.js';

export interface DesktopState {
  locked: boolean;
  sleeping: boolean;
  muted: boolean;
  device: string;
}

// Desktop observations and explicit CLI controls have separate ownership.
export class DesktopGuard {
  private controls: Inhibitions = {
    locked: false,
    muted: false,
    hardware_muted: false,
  };
  private desktop: DesktopState | undefined;

  constructor(
    private readonly inhibit: (
      source: keyof Inhibitions,
      active: boolean,
    ) => void,
  ) {
    this.publish();
  }

  control(source: keyof Inhibitions, active: boolean): void {
    this.controls[source] = active;
    this.publish();
  }

  update(state: DesktopState): void {
    if (this.desktop && this.desktop.device !== state.device)
      this.unavailable();
    this.desktop = state;
    this.publish();
  }

  unavailable(): void {
    this.desktop = undefined;
    this.publish();
  }

  private publish(): void {
    this.inhibit(
      'locked',
      this.controls.locked ||
        !this.desktop ||
        this.desktop.locked ||
        this.desktop.sleeping,
    );
    this.inhibit('muted', this.controls.muted);
    this.inhibit(
      'hardware_muted',
      this.controls.hardware_muted || !this.desktop || this.desktop.muted,
    );
  }
}

const execute = promisify(execFile);
type ReadCommand = (command: string, args: string[]) => Promise<string>;
const readCommand: ReadCommand = async (command, args) =>
  (
    await execute(command, args, {
      timeout: 1500,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    })
  ).stdout;

export async function readDesktopState(
  input: string,
  output: string,
  read: ReadCommand = readCommand,
): Promise<DesktopState> {
  // Keep the sampling gate held until every bounded command has finished,
  // including when one command fails before its siblings.
  const [lock, sleep, sources, sinks] = await Promise.allSettled([
    read('busctl', [
      '--user',
      'call',
      'org.freedesktop.ScreenSaver',
      '/ScreenSaver',
      'org.freedesktop.ScreenSaver',
      'GetActive',
    ]),
    read('busctl', [
      '--system',
      'get-property',
      'org.freedesktop.login1',
      '/org/freedesktop/login1',
      'org.freedesktop.login1.Manager',
      'PreparingForSleep',
    ]),
    read('pactl', ['--format=json', 'list', 'sources']),
    read('pactl', ['--format=json', 'list', 'sinks']),
  ]);
  const value = (result: PromiseSettledResult<string>): string => {
    if (result.status === 'rejected') throw new Error('desktop_unavailable');
    return result.value;
  };
  const boolean = (text: string) => {
    if (!/^b (true|false)\s*$/.test(text))
      throw new Error('desktop_unavailable');
    return text.trim() === 'b true';
  };
  const device = (json: string, name: string) => {
    const devices: unknown = JSON.parse(json);
    if (!Array.isArray(devices)) throw new Error('device_unavailable');
    const selected = devices.find(
      (value) => value?.name === name && name !== 'default',
    );
    if (
      !selected ||
      !Number.isInteger(selected.index) ||
      typeof selected.mute !== 'boolean'
    )
      throw new Error('device_unavailable');
    return selected as { name: string; index: number; mute: boolean };
  };
  const source = device(value(sources), input);
  const sink = device(value(sinks), output);
  if (sink.mute) throw new Error('device_unavailable');
  return {
    locked: boolean(value(lock)),
    sleeping: boolean(value(sleep)),
    muted: source.mute,
    device: `${source.name}:${source.index}/${sink.name}:${sink.index}`,
  };
}

// One sample at a time; no accumulated queue or per-turn event subscription.
// Signals give prompt inhibition; periodic snapshots reconcile startup/reconnect.
export function monitorDesktop(
  input: string,
  output: string,
  guard: DesktopGuard,
): () => void {
  let stopped = false;
  let sampling = false;
  let sampleAgain = false;
  let checkingMute = false;
  let muteAgain = false;
  let epoch = 0;
  let locking = false;
  let sleeping = false;
  const watchers = new Map<string, ReturnType<typeof spawn>>();
  const invalidate = () => {
    epoch++;
    guard.unavailable();
  };
  const sample = async () => {
    if (stopped) return;
    if (sampling) {
      sampleAgain = true;
      return;
    }
    sampling = true;
    const generation = epoch;
    try {
      const state = await readDesktopState(
        input,
        output,
        async (command, args) => {
          try {
            return await readCommand(command, args);
          } catch (error) {
            // Inhibit on the first known failure, while readDesktopState keeps
            // this sample in flight until all sibling commands have drained.
            if (!stopped) invalidate();
            throw error;
          }
        },
      );
      if (!stopped && generation === epoch && watchers.size === 3)
        guard.update({
          ...state,
          locked: state.locked || locking,
          sleeping: state.sleeping || sleeping,
        });
    } catch {
      if (!stopped) invalidate();
    } finally {
      sampling = false;
      if (sampleAgain && !stopped) {
        sampleAgain = false;
        void sample();
      }
    }
  };
  // Source change events include volume and RUNNING/SUSPENDED transitions.
  // Query mute separately so they cannot cancel our own healthy capture, and
  // so a slow KDE/logind snapshot cannot delay an actual mute cancellation.
  const checkMute = async () => {
    if (stopped) return;
    if (checkingMute) {
      muteAgain = true;
      return;
    }
    checkingMute = true;
    try {
      const result = (
        await readCommand('pactl', ['get-source-mute', input])
      ).trim();
      if (result !== 'Mute: no' && result !== 'Mute: yes')
        throw new Error('device_unavailable');
      if (!stopped && result === 'Mute: yes') {
        invalidate();
        void sample();
      }
    } catch {
      if (!stopped) invalidate();
    } finally {
      checkingMute = false;
      if (muteAgain && !stopped) {
        muteAgain = false;
        void checkMute();
      }
    }
  };
  const watch = (key: string, command: string, args: string[]) => {
    if (watchers.has(key)) return;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LC_ALL: 'C' },
    });
    watchers.set(key, child);
    if (!child.stdout) throw new Error('desktop_unavailable');
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (line.length > 8192) {
        child.kill();
        invalidate();
        return;
      }
      if (key === 'pulse' && / on (source|sink|server)(?: #|$)/.test(line)) {
        epoch++;
        if (/ on server\b|'remove'/.test(line)) guard.unavailable();
        if (/ on source(?: #|$)/.test(line)) void checkMute();
        void sample();
      } else if (
        key !== 'pulse' &&
        /ActiveChanged|AboutToLock|PrepareForSleep|NameOwnerChanged|has no owner|owned by/.test(
          line,
        )
      ) {
        if (/AboutToLock|ActiveChanged.*\(true/.test(line)) locking = true;
        if (/ActiveChanged.*\(false/.test(line)) locking = false;
        if (/PrepareForSleep.*\(true/.test(line)) sleeping = true;
        if (/PrepareForSleep.*\(false/.test(line)) sleeping = false;
        invalidate();
        void sample();
      }
    });
    let ended = false;
    const lost = () => {
      if (ended) return;
      ended = true;
      if (key === 'lock') locking = false;
      if (key === 'sleep') sleeping = false;
      lines.close();
      if (watchers.get(key) === child) watchers.delete(key);
      if (!stopped) invalidate();
    };
    child.once('error', lost);
    child.once('exit', lost);
  };
  const tick = () => {
    watch('lock', 'gdbus', [
      'monitor',
      '--session',
      '--dest',
      'org.freedesktop.ScreenSaver',
      '--object-path',
      '/ScreenSaver',
    ]);
    watch('sleep', 'gdbus', [
      'monitor',
      '--system',
      '--dest',
      'org.freedesktop.login1',
      '--object-path',
      '/org/freedesktop/login1',
    ]);
    watch('pulse', 'pactl', ['subscribe']);
    void sample();
  };
  tick();
  const timer = setInterval(tick, 2000);
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const child of watchers.values()) child.kill();
    watchers.clear();
  };
}
