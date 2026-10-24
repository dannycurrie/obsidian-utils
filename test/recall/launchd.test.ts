import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { LABEL, defaultSettings, renderPlist } from '../../scripts/launchd.ts';

const REPO = join(import.meta.dirname, '..', '..');
const template = () => readFile(join(REPO, 'launchd', `${LABEL}.plist`), 'utf8');

/** The plist as launchd reads it, via plutil's JSON conversion. */
async function parsePlist(xml: string): Promise<Record<string, unknown>> {
  const path = join(await mkdtemp(join(tmpdir(), 'book-recall-plist-')), 'agent.plist');
  await writeFile(path, xml);
  await promisify(execFile)('plutil', ['-lint', path]);
  const { stdout } = await promisify(execFile)('plutil', ['-convert', 'json', '-o', '-', path]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

test('the rendered agent runs the CLI with an absolute node at 07:00 and at load, logging to ~/Library/Logs', async () => {
  const settings = defaultSettings('/Users/someone', '/opt/node-24/bin/node');
  const xml = renderPlist(await template(), settings);
  assert.doesNotMatch(xml, /\{\{[A-Z]+\}\}/, 'every placeholder is filled');

  const plist = await parsePlist(xml);
  assert.equal(plist.Label, 'com.danny.book-recall');
  const args = plist.ProgramArguments as string[];
  assert.deepEqual(args.slice(0, 2), ['/bin/sh', '-c']);
  assert.deepEqual(args.slice(3), ['/opt/node-24/bin/node', join(REPO, 'src', 'recall', 'cli.ts')]);
  assert.deepEqual(plist.StartCalendarInterval, { Hour: 7, Minute: 0 });
  assert.equal(plist.RunAtLoad, true);
  assert.equal(plist.StandardOutPath, '/Users/someone/Library/Logs/book-recall.log');
  assert.equal(plist.StandardErrorPath, '/Users/someone/Library/Logs/book-recall.log');
  assert.equal(plist.WorkingDirectory, REPO);
});

test('the sh wrapper stamps the log and passes node and the CLI through', async () => {
  const settings = defaultSettings('/Users/someone', process.execPath);
  const args = (await parsePlist(renderPlist(await template(), settings))).ProgramArguments as string[];
  // Stand in a script that echoes its argument for the CLI, and run the wrapper as launchd would.
  const dir = await mkdtemp(join(tmpdir(), 'book-recall-sh-'));
  const fake = join(dir, 'fake-cli.mjs');
  await writeFile(fake, 'console.log("ran", process.argv.length);\n');
  const { stdout } = await promisify(execFile)(args[0], [args[1], args[2], args[3], fake]);
  assert.match(stdout, /^--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\nran 2\n$/);
});

test('the time is configurable and paths are XML-escaped', async () => {
  const settings = { ...defaultSettings('/Users/a & b', '/opt/node/bin/node'), hour: 6, minute: 30 };
  const plist = await parsePlist(renderPlist(await template(), settings));
  assert.deepEqual(plist.StartCalendarInterval, { Hour: 6, Minute: 30 });
  assert.equal(plist.StandardOutPath, '/Users/a & b/Library/Logs/book-recall.log');
});

test('print renders the plist without installing anything', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [join(REPO, 'scripts', 'launchd.ts'), 'print', '--hour', '8']);
  const plist = await parsePlist(stdout);
  assert.equal((plist.ProgramArguments as string[])[3], process.execPath);
  assert.deepEqual(plist.StartCalendarInterval, { Hour: 8, Minute: 0 });
});

test('a bad time or command is refused', async () => {
  const run = (...args: string[]) =>
    new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(process.execPath, [join(REPO, 'scripts', 'launchd.ts'), ...args], (error, _stdout, stderr) =>
        resolve({ code: error ? 1 : 0, stderr }),
      );
    });
  assert.match((await run('print', '--hour', '24')).stderr, /--hour must be a whole number from 0 to 23/);
  assert.match((await run('print', '--minute', '7.5')).stderr, /--minute must be a whole number from 0 to 59/);
  assert.match((await run('reinstall')).stderr, /Usage: node scripts\/launchd\.ts install\|uninstall\|print/);
});
