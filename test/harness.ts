import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Every file under `dir` with its contents, for byte-identical before/after checks. */
export async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[path] = await readFile(path, 'utf8');
    }
  }
  return files;
}
