import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.ts';
import { defaultConfigPath, loadToken } from '../src/config.ts';
import { TOKEN, makeVault, snapshot, useMockApi } from './harness.ts';

const mock = useMockApi();
const W42_DONE = new Date('2026-10-20T08:00:00Z');
const noKeychain = async () => null;

test('config defaults to ~/.config/week-review/config.json, overridable by env', () => {
  assert.equal(defaultConfigPath({}), join(homedir(), '.config', 'week-review', 'config.json'));
  assert.equal(defaultConfigPath({ WEEK_REVIEW_CONFIG: '/tmp/other.json' }), '/tmp/other.json');
});

test('the env var token wins over the Keychain, which is used otherwise', async () => {
  const keychain = async () => 'from-keychain';
  assert.equal(await loadToken({ WEEK_REVIEW_TOKEN: 'from-env' }, keychain), 'from-env');
  assert.equal(await loadToken({}, keychain), 'from-keychain');
});

test('a missing token explains how to add it to the Keychain', async () => {
  await assert.rejects(
    loadToken({}, noKeychain),
    /security add-generic-password -s week-review -a tracker-api -w <token>/,
  );
});

test('the CLI reads the token from the Keychain when no env var is set', async () => {
  const { configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: '# Plan\n' });
  const result = await run(['--week', '2026-W42', '--config', configPath], {}, W42_DONE, async () => TOKEN);
  assert.equal(result.outcome, 'appended');
});

test('a config holding a token is rejected', async () => {
  const { configPath } = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', config: { apiToken: TOKEN } });
  await assert.rejects(
    run(['--week', '2026-W42', '--config', configPath], { WEEK_REVIEW_TOKEN: TOKEN }, W42_DONE),
    /must not contain secrets \(found "apiToken"\)/,
  );
});

test('while on the mock, the CLI refuses to write to the real vault', async () => {
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: '# Plan\n' });
  // Point realVault at the vault being written, with a trailing slash to check paths are compared canonically.
  const { configPath } = await makeVault({
    baseUrl: mock.baseUrl,
    week: '2026-W42',
    config: { vaultPath: vault.vaultPath, realVault: `${vault.vaultPath}/` },
  });
  const before = await snapshot(vault.dir);

  await assert.rejects(
    run(['--week', '2026-W42', '--config', configPath], { WEEK_REVIEW_TOKEN: TOKEN }, W42_DONE),
    /Refusing to write mock data into the real vault/,
  );
  assert.deepEqual(await snapshot(vault.dir), before);
});

test('the guard allows the real vault once baseUrl is not localhost', async () => {
  const vault = await makeVault({ baseUrl: 'https://tracker.example.invalid', week: '2026-W42', noteContent: '# Plan\n' });
  const { configPath } = await makeVault({
    baseUrl: 'https://tracker.example.invalid',
    week: '2026-W42',
    config: { vaultPath: vault.vaultPath, realVault: vault.vaultPath },
  });
  // Gets past the guard and fails later, at the network.
  await assert.rejects(
    run(['--week', '2026-W42', '--config', configPath], { WEEK_REVIEW_TOKEN: TOKEN }, W42_DONE),
    /Could not reach the tracker API/,
  );
});
