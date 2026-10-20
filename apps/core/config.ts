import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { parse } from 'yaml';
import type defaults from '../../config/defaults.json';

export type Config = Omit<typeof defaults, 'wake_word'> & {
  wake_word: Omit<typeof defaults.wake_word, 'model_path'> & {
    model_path: string | null;
  };
};
const schema = JSON.parse(
  readFileSync(
    new URL(
      '../../../packages/protocol/schemas/config.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const validate = new Ajv({ useDefaults: true }).compile<Config>(schema);

export function configPath(): string {
  return (
    process.env.JARVIS_CONFIG ??
    join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
      'jarvis/config.yaml',
    )
  );
}

export function loadConfig(path?: string): Config {
  let input: unknown = {};
  if (path) {
    try {
      const content = readFileSync(path);
      if (content.length > 65536) throw new Error('too_large');
      input = parse(content.toString('utf8'), { maxAliasCount: 0 });
    } catch {
      throw new Error(
        'invalid_config: unreadable or malformed YAML (maximum 65536 bytes)',
      );
    }
  }
  if (!validate(input)) {
    const error = validate.errors?.[0];
    throw new Error(
      `invalid_config: ${error?.instancePath || '/'} ${error?.keyword ?? 'schema'}`,
    );
  }
  input.wake_word.threshold ??= 0.2;
  try {
    const port = new URL(input.llm.base_url).port;
    if (Number(port || 80) < 1) throw new Error('port');
  } catch {
    throw new Error('invalid_config: /llm/base_url port');
  }
  return input;
}
