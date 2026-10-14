import { lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function runtimeDirectory(): string {
  const root = process.env.XDG_RUNTIME_DIR;
  if (!root || !isAbsolute(root)) throw new Error('missing_runtime_directory');
  const check = (path: string) => {
    const info = lstatSync(path);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    ) {
      throw new Error('unsafe_runtime_directory');
    }
  };
  check(root);
  const directory = join(root, 'jarvis');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  check(directory);
  if (Buffer.byteLength(join(directory, 'audio.sock')) > 103)
    throw new Error('runtime_path_too_long');
  return directory;
}
