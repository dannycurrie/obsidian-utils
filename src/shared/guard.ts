import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A localhost base URL means a local mock or stub, whose output must never land in the real vault. */
export const isLocalUrl = (url: string) => LOCAL_HOSTS.has(new URL(url).hostname);

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** Compares paths canonically, so trailing slashes and symlinks don't hide that they are the same folder. */
export async function isSamePath(a: string, b: string): Promise<boolean> {
  return (await canonicalPath(a)) === (await canonicalPath(b));
}
