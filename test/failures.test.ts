import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/cli.ts';
import { TOKEN, makeVault, runCliResult, snapshot, tokenEnv, useMockApi } from './harness.ts';

const mock = useMockApi();

async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return `http://localhost:${port}`;
}

/** Runs the CLI as a subprocess and asserts it failed with `stderr` without touching the vault. */
async function assertFailsCleanly(options: {
  args: string[];
  vault: Awaited<ReturnType<typeof makeVault>>;
  env?: NodeJS.ProcessEnv;
  stderr: RegExp;
}) {
  const before = await snapshot(options.vault.dir);
  const result = await runCliResult([...options.args, '--config', options.vault.configPath], options.env ?? tokenEnv());
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, options.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(await snapshot(options.vault.dir), before, 'vault is byte-identical');
}

test('a week that has not ended fails before reading config or the vault', async () => {
  // Run in-process so "now" can sit inside the week: Sat 24 Oct 2026, W43.
  const configPath = join('/nonexistent', 'config.json');
  await assert.rejects(
    run(['--week', '2026-W43', '--config', configPath], tokenEnv(), new Date('2026-10-24T12:00:00Z')),
    /2026-W43 has not ended yet/,
  );
});

test('a fully empty week fails rather than writing a review of zeros', async () => {
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W39', noteContent: '# Plan\n' });
  await assertFailsCleanly({ args: ['--week', '2026-W39'], vault, stderr: /2026-W39 has no tracker entries at all/ });
});

test('a rejected token fails with an auth-specific message', async () => {
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', noteContent: '# Plan\n' });
  await assertFailsCleanly({
    args: ['--week', '2026-W42'],
    vault,
    env: { ...process.env, WEEK_REVIEW_TOKEN: `${TOKEN}-wrong` },
    stderr: /rejected the token \(401\)/,
  });
});

test('an unreachable server fails with a connection-specific message', async () => {
  const vault = await makeVault({ baseUrl: await closedPortUrl(), week: '2026-W42', noteContent: '# Plan\n' });
  await assertFailsCleanly({ args: ['--week', '2026-W42'], vault, stderr: /Could not reach the tracker API .*ECONNREFUSED/ });
});

test('a missing vault fails before any write', async () => {
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W42', config: { vaultPath: '/nonexistent/vault' } });
  await assertFailsCleanly({ args: ['--week', '2026-W42'], vault, stderr: /Vault not found: \/nonexistent\/vault/ });
});

test('success prints the note path and a one-line summary, exiting 0', async () => {
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W41', noteContent: '# Plan\n' });

  const result = await runCliResult(['--week', '2026-W41', '--config', vault.configPath], tokenEnv());

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${vault.notePath}\n2026-W41: added review — 7 metrics, 1 with no entries\n`);
});

test('an API that ignores granularity=day fails instead of reading weekly totals as 1/7', async () => {
  // W38's fixture has one weekly period per metric, as the deployed API returns today.
  const vault = await makeVault({ baseUrl: mock.baseUrl, week: '2026-W38', noteContent: '# Plan\n' });
  await assertFailsCleanly({
    args: ['--week', '2026-W38'],
    vault,
    stderr: /did not apply granularity=day \(got no granularity field\)/,
  });
});
