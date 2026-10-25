import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const SECRET_KEY = /token|secret|password|api_?key/i;

/** Config files live outside the vault but are still plain text; secrets belong in the Keychain. */
export function assertNoSecrets(raw: Record<string, unknown>, path: string, hint: string): void {
  const secrets = Object.keys(raw).filter((key) => SECRET_KEY.test(key));
  if (secrets.length) {
    throw new Error(`Config ${path} must not contain secrets (found "${secrets.join('", "')}"); ${hint}`);
  }
}

export type KeychainReader = () => Promise<string | null>;

export function keychainReader(service: string, account: string): KeychainReader {
  return async () => {
    try {
      const { stdout } = await promisify(execFile)('security', ['find-generic-password', '-s', service, '-a', account, '-w']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
}

/** Where one secret comes from: an env var override, otherwise a macOS Keychain item. */
export type SecretSource = {
  /** What the secret is called in error messages, e.g. "API token". */
  label: string;
  envVar: string;
  service: string;
  account: string;
};

/** The env var wins; otherwise the macOS Keychain. */
export async function loadSecret(env: NodeJS.ProcessEnv, source: SecretSource, keychain: KeychainReader): Promise<string> {
  const secret = env[source.envVar] || (await keychain());
  if (!secret) {
    throw new Error(
      `No ${source.label}. Add it to the Keychain with: security add-generic-password -s ${source.service} -a ${source.account} -w <token>`,
    );
  }
  return secret;
}
