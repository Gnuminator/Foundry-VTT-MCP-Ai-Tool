// Pi stage 19, join page background image (scripts/pi/remote/19-join-image.sh, backlog join-page-look):
//   node --test scripts/pi/join-image.test.mjs
// The stage runs in bash against a stand-in worlds folder; `id` says root and `install` ignores the owner (no foundry user here).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, '19-join-image.sh'), 'utf8');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const posix = p => p.replace(/\\/g, '/');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const webp = body => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 '), Buffer.from(body)]);

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

function fakePi({ snapshot = true } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'join-image-'));
  roots.push(d);
  const worlds = path.join(d, 'worlds');
  mkdirSync(path.join(worlds, 'curse-of-strahd'), { recursive: true });
  const dietpiDir = path.join(d, 'dietpi');
  mkdirSync(dietpiDir);
  const stats = path.join(d, 'stats');
  const today = new Date().toLocaleDateString('sv');
  writeFileSync(stats, `${snapshot ? today : '2020-01-01'}_01:25:00  Backup completed\n`);
  return { d, worlds, dietpiDir, stats, dest: path.join(worlds, 'curse-of-strahd', 'join-background.webp') };
}

function run(pi, env) {
  const script = `${lib}\nid() { echo 0; }\ninstall() { local a=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) a+=("$1"); shift;; esac; done; command install "\${a[@]}"; }\nchown() { :; }\n${stage}`;
  const file = path.join(pi.d, 'run.sh');
  writeFileSync(file, script);
  const r = spawnSync('bash', [posix(file)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WORLDS_DIR: posix(pi.worlds),
      DIETPI_DIR: posix(pi.dietpiDir),
      DIETPI_BACKUP_STATS: posix(pi.stats),
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function source(pi, content = webp('abc')) {
  const src = path.join(pi.d, 'join-bg.webp');
  writeFileSync(src, content);
  return { IMAGE_SRC: posix(src), EXPECT_SHA256: sha(content) };
}

describe('19-join-image.sh', () => {
  test('is valid bash', t => {
    const res = spawnSync('bash', ['-n', path.join(remote, '19-join-image.sh')], { encoding: 'utf8' });
    if (res.error) return t.skip('no bash here');
    assert.equal(res.status, 0, res.stderr);
  });

  test('a dry run changes nothing and needs no snapshot', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, { ...source(pi), DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dry run: would install/);
    assert.equal(existsSync(pi.dest), false);
  });

  test('a real run installs the file and checks the hash', () => {
    const pi = fakePi();
    const env = source(pi);
    const r = run(pi, env);
    assert.equal(r.status, 0, r.out);
    assert.equal(sha(readFileSync(pi.dest)), env.EXPECT_SHA256);
  });

  test('a real run without a snapshot from today is refused', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, source(pi));
    assert.notEqual(r.status, 0);
    assert.match(r.out, /snapshot/);
    assert.equal(existsSync(pi.dest), false);
  });

  test('a wrong hash, a file that is not a webp and a missing world are refused', () => {
    const pi = fakePi();
    assert.notEqual(run(pi, { ...source(pi), EXPECT_SHA256: 'a'.repeat(64) }).status, 0);
    const notWebp = Buffer.from('GIF89a not a webp file');
    const r = run(pi, source(pi, notWebp));
    assert.notEqual(r.status, 0);
    assert.match(r.out, /not a webp/);
    const r2 = run(pi, { ...source(pi), WORLD: 'no-such-world' });
    assert.notEqual(r2.status, 0);
    assert.match(r2.out, /no world folder/);
    assert.equal(existsSync(pi.dest), false);
  });

  test('the same file again changes nothing; another file needs REPLACE=1 and is kept as .old', () => {
    const pi = fakePi();
    assert.equal(run(pi, source(pi)).status, 0);
    const again = run(pi, source(pi));
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /nothing to change/);
    const other = webp('different');
    const refused = run(pi, source(pi, other));
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /REPLACE=1/);
    const env = { ...source(pi, other), REPLACE: '1' };
    assert.equal(run(pi, env).status, 0);
    assert.equal(sha(readFileSync(pi.dest)), env.EXPECT_SHA256);
    assert.equal(existsSync(`${pi.dest}.old`), true);
  });

  test('UNDO removes the file only when it has the named hash', () => {
    const pi = fakePi();
    const env = source(pi);
    run(pi, env);
    const wrong = run(pi, { EXPECT_SHA256: 'b'.repeat(64), UNDO: '1' });
    assert.notEqual(wrong.status, 0);
    assert.equal(existsSync(pi.dest), true);
    const r = run(pi, { EXPECT_SHA256: env.EXPECT_SHA256, UNDO: '1' });
    assert.equal(r.status, 0, r.out);
    assert.equal(existsSync(pi.dest), false);
  });

  test('odd world ids and file names are refused', () => {
    const pi = fakePi();
    assert.notEqual(run(pi, { ...source(pi), WORLD: '../x' }).status, 0);
    assert.notEqual(run(pi, { ...source(pi), DEST_NAME: '../evil.webp' }).status, 0);
  });
});
