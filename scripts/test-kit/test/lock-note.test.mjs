/**
 * scripts/test-env/lock.ps1 writes the test server lock state to the vault note the PM board reads
 * (`Dev/Foundry AI Tool/Test servers.md`). Every run here uses a scratch lock directory (-Root) and a
 * scratch vault clone (-Vault) with a local bare remote: no real server lock and no real vault is
 * touched. Skipped where pwsh 7 or git is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(root, 'scripts', 'test-env', 'lock.ps1');
const NOTE = path.join('Dev', 'Foundry AI Tool', 'Test servers.md');

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();
const hasGit = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = (!hasPwsh && 'pwsh is missing') || (!hasGit && 'git is missing');

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A scratch lock directory per server and a vault clone of a bare remote. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-note-'));
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  const vault = path.join(dir, 'vault');
  git(dir, 'clone', '-q', remote, vault);
  git(vault, 'config', 'user.email', 'test@example.invalid');
  git(vault, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(vault, 'README.md'), 'vault\n');
  git(vault, 'add', '.');
  git(vault, 'commit', '-q', '-m', 'init');
  git(vault, 'push', '-q', '-u', 'origin', 'main');
  return { dir, remote, vault };
}

/**
 * @param {{ dir: string, vault: string }} s
 * @param {string[]} args  lock.ps1 arguments
 * @param {{ server?: string, vault?: string | null }} [o]  vault: null leaves -Vault out
 */
function lock(s, args, o = {}) {
  const server = o.server ?? 'A';
  const argv = ['-NoProfile', '-NonInteractive', '-File', script, ...args, '-Server', server, '-Root', path.join(s.dir, `root${server}`)];
  const vault = o.vault === undefined ? s.vault : o.vault;
  if (vault) argv.push('-Vault', vault);
  return spawnSync('pwsh', argv, { encoding: 'utf8' });
}

/** The note's `key: value` lines as an object. @param {string} file */
function readNote(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  assert.ok(m, 'frontmatter');
  return Object.fromEntries(m[1].split('\n').map(l => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
}

const take = (holder, session, extra = []) => ['take', '-Holder', holder, '-Session', session, '-Purpose', 'secret purpose text', ...extra];

test(
  'take, queue, release: the note follows, one server at a time, and the other servers keep their lines',
  { skip },
  () => {
    const s = scratch();
    const noteFile = path.join(s.vault, NOTE);

    assert.equal(lock(s, take('lane-one', 'local_1')).status, 0);
    let n = readNote(noteFile);
    assert.equal(n.type, 'test-servers');
    assert.equal(n['server-a'], 'held');
    assert.equal(n['server-a-holder'], 'lane-one');
    assert.match(n['server-a-since'], /^\d{4}-\d\d-\d\dT/);
    assert.equal(n['server-a-queue'], '0');
    assert.match(n.updated, /^\d{4}-\d\d-\d\dT/);

    assert.equal(lock(s, take('lane-b', 'local_b'), { server: 'B' }).status, 0);
    assert.equal(lock(s, ['queue', '-Holder', 'lane-two', '-Session', 'local_2', '-Purpose', 'x']).status, 0);
    n = readNote(noteFile);
    assert.equal(n['server-a-queue'], '1');
    assert.equal(n['server-b'], 'held');
    assert.equal(n['server-b-holder'], 'lane-b');

    assert.equal(lock(s, ['release', '-Session', 'local_1']).status, 0);
    n = readNote(noteFile);
    assert.equal(n['server-a'], 'free');
    assert.equal(n['server-a-holder'], undefined);
    assert.equal(n['server-a-since'], undefined);
    assert.equal(n['server-a-queue'], '1');
    assert.equal(n['server-b'], 'held', 'server B untouched by a server A release');

    // the commit reached the remote, and only the note was committed
    assert.equal(git(s.vault, 'rev-parse', 'HEAD'), git(s.vault, 'rev-parse', 'origin/main'));
    assert.equal(git(s.vault, 'show', '--name-only', '--format=', 'HEAD'), NOTE.replaceAll('\\', '/'));
    assert.equal(git(s.vault, 'status', '--short'), '');
  }
);

test('a steal (take -Force) writes the new holder; the note never carries purposes or paths', { skip }, () => {
  const s = scratch();
  assert.equal(lock(s, take('lane-one', 'local_1')).status, 0);
  assert.equal(lock(s, take('lane-two', 'local_2', ['-Force'])).status, 0);
  const text = fs.readFileSync(path.join(s.vault, NOTE), 'utf8');
  assert.equal(readNote(path.join(s.vault, NOTE))['server-a-holder'], 'lane-two');
  assert.doesNotMatch(text, /secret purpose|local_|lock\.json|[A-Z]:\\/);
});

test('a refused take writes nothing', { skip }, () => {
  const s = scratch();
  assert.equal(lock(s, take('lane-one', 'local_1')).status, 0);
  const before = git(s.vault, 'rev-parse', 'HEAD');
  assert.equal(lock(s, take('lane-two', 'local_2')).status, 1);
  assert.equal(git(s.vault, 'rev-parse', 'HEAD'), before);
});

test('a holder title is cut to one line of at most 60 characters', { skip }, () => {
  const s = scratch();
  assert.equal(lock(s, take('a'.repeat(100), 'local_1')).status, 0);
  assert.equal(readNote(path.join(s.vault, NOTE))['server-a-holder'], 'a'.repeat(60));
});

test('a vault push that fails is a warning: the lock is still taken, exit 0', { skip }, () => {
  const s = scratch();
  git(s.vault, 'remote', 'set-url', 'origin', path.join(s.dir, 'missing.git'));
  const r = lock(s, take('lane-one', 'local_1'));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARNING: test servers note/);
  const status = lock(s, ['status']);
  assert.match(status.stdout, /held by lane-one/);
});

test('no vault checkout, or -Root without -Vault: nothing is written and nothing fails', { skip }, () => {
  const s = scratch();
  assert.equal(lock(s, take('lane-one', 'local_1'), { vault: null }).status, 0);
  assert.equal(fs.existsSync(path.join(s.vault, NOTE)), false);
  const bare = path.join(s.dir, 'not-a-repo');
  fs.mkdirSync(bare);
  const r = lock(s, ['release', '-Session', 'local_1'], { vault: bare });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(fs.readdirSync(bare), []);
});

test('publish writes the current state without changing the lock', { skip }, () => {
  const s = scratch();
  assert.equal(lock(s, take('lane-one', 'local_1'), { vault: null }).status, 0);
  assert.equal(lock(s, ['publish']).status, 0);
  assert.equal(readNote(path.join(s.vault, NOTE))['server-a-holder'], 'lane-one');
  assert.match(lock(s, ['status']).stdout, /held by lane-one/);
});
