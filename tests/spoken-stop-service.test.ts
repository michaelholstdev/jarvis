import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../apps/core/config.js';
import { createCore } from '../apps/core/core.js';
import { request } from '../apps/core/transport.js';
import { runTurn } from '../apps/core/turn-driver.js';

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('audio fixture did not reach the expected process boundary');
}

for (const mode of ['voice', 'manual', 'replacement', 'privacy'] as const) {
  test(
    mode === 'privacy'
      ? 'privacy erases delivery metadata retained after audio socket disconnect'
      : `${mode} stop retains drained speech after the real audio socket disconnects`,
    { timeout: 10000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'jv-stop-svc-'));
      const configPath = join(directory, 'config.json');
      const modelPath = join(directory, 'voice.onnx');
      const pidPath = join(directory, 'worker.pid');
      writeFileSync(modelPath, 'fixture-model');
      writeFileSync(`${modelPath}.json`, '{}');
      writeFileSync(
        configPath,
        JSON.stringify({
          audio: { mode: 'piper' },
          tts: { model_path: modelPath },
          interaction: { activation_sound: false },
        }),
      );
      const config = loadConfig(configPath);
      const core = createCore({ now: () => 0 }, config);
      core.dispatch({ type: 'audio-ready' });
      core.activate();
      core.dispatch({
        type: 'recognized',
        operation_id: core.operations()[0]?.operation_id ?? '',
        text: 'Frage',
      });
      core.dispatch({
        type: 'inferred',
        operation_id: core.operations()[0]?.operation_id ?? '',
        text: 'Hallo. Ungehört.',
      });
      const audio = spawn(
        '.venv/bin/python',
        ['tests/fixtures/spoken-stop/audio_service.py'],
        {
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: directory,
            JARVIS_CONFIG: configPath,
            STOP_FIXTURE_MODE: mode,
            STOP_FIXTURE_PID: pidPath,
          },
        },
      );
      let logs = '';
      audio.stdout.on('data', (chunk) => {
        logs += chunk;
      });
      audio.stderr.on('data', (chunk) => {
        logs += chunk;
      });
      try {
        await waitFor(() => logs.includes('service_started'));
        const synthesis = core.operations()[0];
        assert.equal(synthesis?.type, 'synthesize');
        const playing = runTurn(
          core,
          join(directory, 'jarvis/audio.sock'),
          config,
        );
        await waitFor(
          () => existsSync(pidPath) && logs.includes('playback_delivered'),
        );
        if (mode === 'manual') core.stop();
        if (mode === 'replacement') core.activate();
        if (mode === 'privacy')
          core.dispatch({
            type: 'inhibition-changed',
            source: 'muted',
            active: true,
          });
        await playing;
        const { pid, operation_id: playbackId } = JSON.parse(
          readFileSync(pidPath, 'utf8'),
        ) as { pid: number; operation_id: string };
        // Reproduce normal daemon scheduling: abort cleanup kills the audio worker
        // before the next ticker sends the cancel operation.
        await waitFor(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
        await runTurn(core, join(directory, 'jarvis/audio.sock'), config);
        if (mode === 'privacy') {
          assert.equal(core.reply(), null);
          core.dispatch({
            type: 'inhibition-changed',
            source: 'muted',
            active: false,
          });
          await runTurn(core, join(directory, 'jarvis/audio.sock'), config);
        } else {
          assert.equal(
            core.status().state,
            mode === 'replacement' ? 'listening' : 'follow-up',
            logs,
          );
          assert.deepEqual(core.reply(), {
            text: 'Hallo. ',
            delivered_chars: 7,
            completed: false,
          });
          core.dispatch({
            type: 'recognized',
            operation_id: core.operations()[0]?.operation_id ?? '',
            text: 'Mehr dazu?',
          });
          assert.deepEqual(core.operations()[0]?.context, [
            { question: 'Frage', reply: 'Hallo. ' },
          ]);
        }
        // Cancellation consumes delivery metadata once; privacy clears it outright.
        const late = await request(
          join(directory, 'jarvis/audio.sock'),
          'core',
          config.transport,
          {
            version: 1,
            type: 'audio-operation',
            operation: {
              type: 'cancel',
              operation_id: 'late',
              target_operation_id: playbackId,
            },
          },
        );
        assert.deepEqual(late, {
          version: 1,
          type: 'audio-result',
          operation_id: 'late',
          completed: false,
          delivered_chars: 0,
        });
      } finally {
        audio.kill('SIGTERM');
        await once(audio, 'exit');
        rmSync(directory, { recursive: true });
      }
    },
  );
}
