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
