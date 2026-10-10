// Tests for the GM password check (#273): gm_password_check in scripts/pi/remote/lib-gm-passwords.sh, the wrapper
// scripts/pi/remote/gm-passwords.sh and the refusal at the top of scripts/pi/remote/12-tunnel.sh.
//   node --test scripts/pi/gm-passwords.test.mjs
// No real LevelDB: each test builds a fake classic-level (reads a fixture.json from the "database" folder), a
// node wrapper and a fake Foundry data folder, then runs the real shell code against them with bash.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, 'remote', 'lib.sh');
const gmLib = path.join(here, 'remote', 'lib-gm-passwords.sh');
const wrapper = path.join(here, 'remote', 'gm-passwords.sh');
const stage12 = path.join(here, 'remote', '12-tunnel.sh');

const bashProbe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const noBash = bashProbe.status !== 0 && 'no bash here';

// Forward slashes work in Git Bash and on Linux alike.
const fwd = p => p.replace(/\\/g, '/');

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const FAKE_CLASSIC_LEVEL = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
class ClassicLevel {
  constructor(dir) {
    this.dir = dir;
    this.entries = [];
  }
  async open() {
    const file = path.join(this.dir, 'fixture.json');
    if (!fs.existsSync(file)) throw new Error('no fixture');
    this.entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  async *iterator() {
    for (const e of this.entries) yield [e[0], e[1]];
  }
  async close() {}
}
module.exports = { ClassicLevel };
`;

/** A fresh fake install: app (with a fake classic-level), node dir, empty data folder. */
function makeRoot({ withLevel = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gm-pw-test-'));
  roots.push(root);
  const app = path.join(root, 'app');
  const data = path.join(root, 'data');
  const nodeDir = path.join(root, 'node');
  mkdirSync(app, { recursive: true });
  mkdirSync(path.join(data, 'Data', 'worlds'), { recursive: true });
  mkdirSync(path.join(nodeDir, 'bin'), { recursive: true });
  if (withLevel) {
    const level = path.join(app, 'node_modules', 'classic-level');
    mkdirSync(level, { recursive: true });
    writeFileSync(
      path.join(level, 'package.json'),
      JSON.stringify({ name: 'classic-level', version: '0.0.0', main: 'index.js' })
    );
    writeFileSync(path.join(level, 'index.js'), FAKE_CLASSIC_LEVEL);
  }
  const nodeBin = path.join(nodeDir, 'bin', 'node');
  writeFileSync(nodeBin, `#!/bin/sh\nexec '${fwd(process.execPath)}' "$@"\n`);
  chmodSync(nodeBin, 0o755);
  return { root: fwd(root), app: fwd(app), data: fwd(data), nodeDir: fwd(nodeDir) };
}

const newSalt = () => randomBytes(16).toString('hex');
const hashOf = (pw, salt) => pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex');

let uid = 0;
/** A user record as Foundry 14 stores it: a salted PBKDF2 hash, also of the empty password. */
function user(name, role, password) {
  const salt = newSalt();
  return {
    _id: `u${String(++uid).padStart(15, '0')}`,
    name,
    role,
    passwordSalt: salt,
    password: hashOf(password, salt),
  };
}

/** Add a world with a users database holding these records (or raw [key, value] pairs). */
function addWorld(env, id, users, { raw } = {}) {
  const dir = path.join(env.data, 'Data', 'worlds', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'world.json'), JSON.stringify({ id, title: id }));
  if (users === null) return;
  const db = path.join(dir, 'data', 'users');
  mkdirSync(db, { recursive: true });
  const entries = raw ?? users.map(u => [`!users!${u._id}`, JSON.stringify(u)]);
  writeFileSync(path.join(db, 'fixture.json'), JSON.stringify(entries));
}

/** Run gm_password_check (lib.sh, then lib-gm-passwords.sh). Paths go in as positional args. */
function runCheck(env) {
  const script =
    'source "$1"; source "$5"; FOUNDRY_DATA="$2"; FOUNDRY_APP="$3"; NODE_DIR="$4"; ' +
    'rc=0; gm_password_check || rc=$?; echo "rc=$rc"';
  const res = spawnSync(
    'bash',
    ['-c', script, 'bash', fwd(lib), env.data, env.app, env.nodeDir, fwd(gmLib)],
    {
      encoding: 'utf8',
    }
  );
  const m = /rc=(\d+)\s*$/.exec(res.stdout);
  assert.ok(m, `no rc line; stdout=${res.stdout} stderr=${res.stderr}`);
  return { rc: Number(m[1]), out: res.stdout, err: res.stderr };
}

/** The snippet that re-sets the three variables and stubs the checks that need a root Pi. */
const override = (extra = '') =>
  `FOUNDRY_DATA="$1"; FOUNDRY_APP="$2"; NODE_DIR="$3"\n` + `require_root() { :; }\n${extra}\n`;

/** Pipe lib.sh + lib-gm-passwords.sh + snippet + script into `bash -s`, the way the stages run over ssh. */
function runPiped(env, snippet, scriptFile) {
  const input =
    readFileSync(lib, 'utf8') +
    '\n' +
    readFileSync(gmLib, 'utf8') +
    '\n' +
    snippet +
    '\n' +
    readFileSync(scriptFile, 'utf8') +
    '\n';
  return spawnSync('bash', ['-s', '--', env.data, env.app, env.nodeDir], {
    input,
    encoding: 'utf8',
  });
}

const tmpEntries = () => {
  const res = spawnSync('bash', ['-c', 'ls -d /tmp/gm-password-check.* 2>/dev/null || true'], {
    encoding: 'utf8',
  });
  return new Set(res.stdout.split('\n').filter(Boolean));
};

describe('gm_password_check', { skip: noBash }, () => {
  test('a GM and an Assistant GM with real passwords pass', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [
      user('Gamemaster', 4, 'hunter2'),
      user('Helper', 3, 'swordfish'),
      user('Anna', 1, ''),
    ]);
    const r = runCheck(env);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.match(r.out, /ok: strahd:/);
    assert.doesNotMatch(r.out, /FOUND/);
  });

  test('a Gamemaster with the empty password is found', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, '')]);
    const r = runCheck(env);
    assert.equal(r.rc, 3, r.out + r.err);
    assert.match(r.out, /FOUND: strahd: Gamemaster "Chris" has no password/);
  });

  test('an Assistant GM with the empty password is found', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, 'pw'), user('Sidekick', 3, '')]);
    const r = runCheck(env);
    assert.equal(r.rc, 3, r.out + r.err);
    assert.match(r.out, /FOUND: strahd: Assistant GM "Sidekick" has no password/);
    assert.doesNotMatch(r.out, /Gamemaster "Chris"/);
  });

  test('a player with the empty password is ignored', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, 'pw'), user('Anna', 1, '')]);
    const r = runCheck(env);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.doesNotMatch(r.out, /FOUND/);
  });

  test('legacy records without a salt: empty is found, plaintext passes', () => {
    const empty = makeRoot();
    addWorld(empty, 'old', [{ _id: 'a'.repeat(16), name: 'Old GM', role: 4, password: '' }]);
    const a = runCheck(empty);
    assert.equal(a.rc, 3, a.out + a.err);
    assert.match(a.out, /FOUND: old: Gamemaster "Old GM" has no password/);

    const plain = makeRoot();
    addWorld(plain, 'old', [{ _id: 'b'.repeat(16), name: 'Old GM', role: 4, password: 'letmein' }]);
    const b = runCheck(plain);
    assert.equal(b.rc, 0, b.out + b.err);
    assert.match(b.out, /ok: old:/);
  });

  test('a world that was never launched is found', () => {
    const env = makeRoot();
    addWorld(env, 'fresh', null);
    const r = runCheck(env);
    assert.equal(r.rc, 3, r.out + r.err);
    assert.match(r.out, /FOUND: fresh: .*never launched/);
  });

  test('a world with no Gamemaster is found', () => {
    const env = makeRoot();
    addWorld(env, 'headless', [user('Anna', 1, 'pw'), user('Bo', 3, 'pw')]);
    const r = runCheck(env);
    assert.equal(r.rc, 3, r.out + r.err);
    assert.match(r.out, /FOUND: headless: no Gamemaster/);
  });

  test('no role-4 user, but a player named "Gamemaster": a password passes, an empty one is found', () => {
    const withPw = makeRoot();
    addWorld(withPw, 'w', [user('Gamemaster', 1, 'secret')]);
    const a = runCheck(withPw);
    assert.equal(a.rc, 0, a.out + a.err);
    assert.doesNotMatch(a.out, /FOUND/);

    const without = makeRoot();
    addWorld(without, 'w', [user('Gamemaster', 1, '')]);
    const b = runCheck(without);
    assert.equal(b.rc, 3, b.out + b.err);
    assert.match(b.out, /FOUND: w: no Gamemaster/);
  });

  test('a folder without world.json is skipped', () => {
    const env = makeRoot();
    addWorld(env, 'real', [user('Chris', 4, 'pw')]);
    mkdirSync(path.join(env.data, 'Data', 'worlds', 'not-a-world'), { recursive: true });
    const r = runCheck(env);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.match(r.out, /ok: real:/);
    assert.doesNotMatch(r.out + r.err, /not-a-world/);
  });

  test('a missing worlds folder passes', () => {
    const env = makeRoot();
    rmSync(path.join(env.data, 'Data', 'worlds'), { recursive: true });
    const r = runCheck(env);
    assert.equal(r.rc, 0, r.out + r.err);
  });

  test('an unreadable users database returns 1 with an ERROR line', () => {
    const env = makeRoot();
    addWorld(env, 'broken', [], { raw: [['!users!x', 'not json {']] });
    const r = runCheck(env);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.match(r.err, /ERROR: broken: the users database could not be read/);
  });

  test('nothing secret is printed', () => {
    const env = makeRoot();
    const users = [
      user('Chris', 4, 'pw1'),
      user('Sidekick', 3, 'pw2'),
      user('Anna', 1, 'pw3'),
      user('Empty', 3, ''),
    ];
    addWorld(env, 'strahd', users);
    const r = runCheck(env);
    assert.equal(r.rc, 3, r.out + r.err);
    const all = r.out + r.err;
    for (const u of users) {
      assert.ok(!all.includes(u.passwordSalt), 'a salt was printed');
      assert.ok(!all.includes(u.password), 'a hash was printed');
    }
  });

  test('the /tmp work folder is removed afterwards', () => {
    const before = tmpEntries();
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, 'pw')]);
    addWorld(env, 'broken', [], { raw: [['k', 'nope']] });
    runCheck(env);
    const added = [...tmpEntries()].filter(p => !before.has(p));
    assert.deepEqual(added, []);
  });

  test('a missing classic-level returns 1', () => {
    const env = makeRoot({ withLevel: false });
    addWorld(env, 'strahd', [user('Chris', 4, 'pw')]);
    const r = runCheck(env);
    assert.equal(r.rc, 1, r.out + r.err);
    assert.match(r.err, /classic-level is missing/);
  });
});

describe('gm-passwords.sh', { skip: noBash }, () => {
  test('exits 3 on a found world and 0 on a clean one', () => {
    const bad = makeRoot();
    addWorld(bad, 'strahd', [user('Chris', 4, '')]);
    const a = runPiped(bad, override(), wrapper);
    assert.equal(a.status, 3, a.stdout + a.stderr);
    assert.match(a.stdout, /FOUND: strahd: Gamemaster "Chris" has no password/);
    assert.match(a.stdout, /found: set a password/);

    const good = makeRoot();
    addWorld(good, 'strahd', [user('Chris', 4, 'pw')]);
    const b = runPiped(good, override(), wrapper);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(b.stdout, /none: every world's Gamemaster/);
  });
});

describe('12-tunnel.sh', { skip: noBash }, () => {
  const stubs = 'require_arm64() { :; }\napt_install() { echo APT-CALLED; exit 0; }';

  test('refuses while a world has a GM with no password', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, '')]);
    const r = runPiped(env, override(stubs), stage12);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /no password/);
    assert.match(r.stderr, /Nothing was changed/);
    assert.doesNotMatch(r.stdout, /APT-CALLED/);
  });

  test('refuses when a world cannot be read', () => {
    const env = makeRoot();
    addWorld(env, 'broken', [], { raw: [['k', 'nope']] });
    const r = runPiped(env, override(stubs), stage12);
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /could not read/);
    assert.doesNotMatch(r.stdout, /APT-CALLED/);
  });

  test('passes the GM check on a clean world and goes on to the install step', () => {
    const env = makeRoot();
    addWorld(env, 'strahd', [user('Chris', 4, 'pw')]);
    const r = runPiped(env, override(stubs), stage12);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /every world's Gamemaster and Assistant GM users have a password/);
    assert.match(r.stdout, /APT-CALLED/);
  });
});
