import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../apps/core/config.js';

test('empty configuration gives private German CPU defaults', () => {
  const config = loadConfig();
  assert.equal(config.locale, 'de-DE');
  assert.equal(config.session.follow_up_seconds, 20);
  assert.equal(config.session.max_duration_seconds, 300);
  assert.equal(config.session.extension_response_seconds, 20);
  assert.equal(config.session.extension_duration_seconds, 300);
  assert.equal(config.stt.device, 'cpu');
  assert.equal(config.features.external_tools, false);
});

test('configuration rejects remote endpoints, unsafe features, typos and timer bounds without echoing values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-config-'));
  try {
    const path = join(directory, 'config.yaml');
    for (const content of [
      'llm:\n  base_url: https://private.example/secret',
      'session:\n  follow_up_seconds: 61',
      'session:\n  follow_up_seconds: 4',
      'session:\n  follow_up_seconds: 20.5',
      'session:\n  recognition_completion_seconds: 0',
      'session:\n  recognition_completion_seconds: 31',
      'features:\n  external_tools: true',
      'logging:\n  content_logging: true',
      'logging:\n  content_logging: off',
      'audio:\n  1: secret',
      'unknown: secret',
      'wake_word:\n  model_path: unverified-model',
      'llm:\n  base_url: http://127.0.0.1:65536',
      'session:\n  follow_up_seconds: 5\n  follow_up_seconds: 60',
    ]) {
      writeFileSync(path, content);
      assert.throws(() => loadConfig(path), /^Error: invalid_config:/);
    }
    writeFileSync(
      path,
      'audio:\n  input_device: headset-stable-id\ninteraction:\n  activation_sound: false',
    );
    const config = loadConfig(path);
    assert.equal(config.audio.input_device, 'headset-stable-id');
    assert.equal(config.audio.output_device, 'default');
    assert.equal(config.interaction.activation_sound, false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('configuration accepts both follow-up and recognition allowance boundaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-config-'));
  try {
    const path = join(directory, 'config.yaml');
    for (const [followUp, allowance] of [
      [5, 1],
      [60, 30],
    ]) {
      writeFileSync(
        path,
        JSON.stringify({
          session: {
            follow_up_seconds: followUp,
            recognition_completion_seconds: allowance,
          },
        }),
      );
      const config = loadConfig(path);
      assert.equal(config.session.follow_up_seconds, followUp);
      assert.equal(config.session.recognition_completion_seconds, allowance);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('conversation allowance and extension settings validate their own integer bounds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-config-'));
  try {
    const path = join(directory, 'config.yaml');
    for (const [key, minimum, maximum] of [
      ['max_duration_seconds', 30, 3600],
      ['extension_duration_seconds', 30, 3600],
      ['extension_response_seconds', 5, 60],
    ] as const) {
      for (const value of [minimum, maximum]) {
        writeFileSync(path, JSON.stringify({ session: { [key]: value } }));
        assert.equal(loadConfig(path).session[key], value);
      }
      for (const value of [minimum - 1, maximum + 1, minimum + 0.5]) {
        writeFileSync(path, JSON.stringify({ session: { [key]: value } }));
        assert.throws(() => loadConfig(path), /^Error: invalid_config:/);
      }
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
