import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCore } from '../apps/core/core.js';
import { DesktopGuard } from '../apps/core/desktop.js';

const available = {
  locked: false,
  sleeping: false,
  muted: false,
  device: 'mic:41/sink:52',
};

test('desktop lock and device mute merge with CLI controls and recovery never resumes work', () => {
  const core = createCore({ now: () => 0 });
  const guard = new DesktopGuard((source, active) =>
    core.dispatch({ type: 'inhibition-changed', source, active }),
  );
  const settle = () => {
    core.dispatch({ type: 'audio-ready' });
    const barrier = core.operations()[0];
    if (barrier?.type === 'privacy')
      core.dispatch({
        type: 'privacy-applied',
        operation_id: barrier.operation_id,
      });
  };
  settle();
  assert.equal(core.status().manual_activation, 'unavailable');
  guard.update(available);
  settle();
  core.activate();
  assert.equal(core.status().state, 'acknowledging');
  guard.update({ ...available, locked: true, muted: true });
  settle();
  assert.equal(core.status().state, 'idle');
  guard.update({ ...available, muted: true });
  guard.control('hardware_muted', false);
  settle();
  assert.throws(() => core.activate(), /unavailable/);
  assert.equal(core.status().state, 'idle');
  guard.control('muted', true);
  guard.update(available);
  settle();
  assert.equal(core.status().inhibitions.muted, true);
  guard.control('muted', false);
  settle();
  assert.equal(core.status().manual_activation, 'mock');
  assert.deepEqual(core.operations(), []);
  assert.equal(core.textAnswer(), null);
});

test('device replacement, suspend and unavailable desktop observations close work before readiness returns', () => {
  const core = createCore({ now: () => 0 });
  const guard = new DesktopGuard((source, active) =>
    core.dispatch({ type: 'inhibition-changed', source, active }),
  );
  const settle = () => {
    core.dispatch({ type: 'audio-ready' });
    const barrier = core.operations()[0];
    if (barrier?.type === 'privacy')
      core.dispatch({
        type: 'privacy-applied',
        operation_id: barrier.operation_id,
      });
  };
  guard.update(available);
  settle();
  core.activate();
  guard.update({ ...available, device: 'mic:63/sink:52' });
  settle();
  assert.equal(core.status().state, 'idle');
  assert.deepEqual(core.operations(), []);
  core.activate();
  guard.update({ ...available, sleeping: true });
  settle();
  assert.equal(core.status().manual_activation, 'unavailable');
  guard.update(available);
  settle();
  assert.deepEqual(core.operations(), []);
  core.activate();
  guard.unavailable();
  settle();
  assert.equal(core.status().manual_activation, 'unavailable');
  guard.update(available);
  settle();
  assert.equal(core.status().state, 'idle');
  assert.deepEqual(core.operations(), []);
});

test('desktop snapshot reads KDE lock, logind sleep and the selected stable device mute without opening capture', async () => {
  const { readDesktopState } = await import('../apps/core/desktop.js');
  const calls: string[] = [];
  let muted = true;
  const read = async (command: string, args: string[]) => {
    calls.push([command, ...args].join(' '));
    if (command === 'busctl')
      return args.includes('GetActive') ? 'b false\n' : 'b true\n';
    return JSON.stringify([
      {
        name: args.includes('sources') ? 'headset-mic' : 'headset-out',
        index: 7,
        mute: args.includes('sources') ? muted : false,
      },
    ]);
  };
  assert.deepEqual(await readDesktopState('headset-mic', 'headset-out', read), {
    locked: false,
    sleeping: true,
    muted: true,
    device: 'headset-mic:7/headset-out:7',
  });
  muted = false;
  assert.equal(
    (await readDesktopState('headset-mic', 'headset-out', read)).muted,
    false,
  );
  await assert.rejects(readDesktopState('missing', 'headset-out', read));
  assert.ok(
    calls.every(
      (call) => call.startsWith('busctl ') || call.startsWith('pactl '),
    ),
  );
});

test('a failed desktop snapshot waits for outstanding commands before admitting another sample', async () => {
  const { readDesktopState } = await import('../apps/core/desktop.js');
  let release: () => void = () => {};
  const outstanding = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  const sample = readDesktopState(
    'headset-mic',
    'headset-out',
    async (_command, args) => {
      if (args.includes('GetActive')) throw new Error('lock_query_failed');
      await outstanding;
      if (args.includes('sinks')) throw new Error('sink_query_failed');
      return '';
    },
  );
  const outcome = sample.then(
    () => {
      finished = true;
      return 'ready';
    },
    () => {
      finished = true;
      return 'unavailable';
    },
  );
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      finished,
      false,
      'failure must not leave commands running after the snapshot finishes',
    );
  } finally {
    release();
    assert.equal(await outcome, 'unavailable');
  }
});
