// Pi stage 19, join page look (scripts/pi/remote/19-join-page-look.sh, backlog join-page-look):
//   node --test scripts/pi/join-page-look.test.mjs
// The stage runs in bash against a stand-in worlds folder, with stand-ins for systemctl, curl, runuser and the quiet check
// (lib.sh's require_quiet has its own tests); `id` says root and `install` ignores the owner (no foundry user here).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, '19-join-page-look.sh'), 'utf8');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const posix = p => p.replace(/\\/g, '/');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const webp = body =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 '), Buffer.from(body)]);
const DESC = '<h2>Session 0</h2><p>Bring a character.</p>';

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

// A fake Pi. The stand-in curl serves a join page that names the background `served` says (none when empty).
function fakePi({ snapshot = true, world = {} } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'join-look-'));
  roots.push(d);
  const worlds = path.join(d, 'worlds');
  mkdirSync(path.join(worlds, 'curse-of-strahd'), { recursive: true });
  writeFileSync(
    path.join(worlds, 'curse-of-strahd', 'world.json'),
    JSON.stringify({ id: 'curse-of-strahd', title: 'Curse of Strahd', playtime: 5, description: '<p>old</p>', ...world }, null, 2),
  );
  const dietpiDir = path.join(d, 'dietpi');
  mkdirSync(dietpiDir);
  const stats = path.join(d, 'stats');
  const today = new Date().toLocaleDateString('sv');
  writeFileSync(stats, `${snapshot ? today : '2020-01-01'}_01:25:00  Backup completed\n`);
  const bin = path.join(d, 'node', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'node'), `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "$@"\n`);
  chmodSync(path.join(bin, 'node'), 0o755);
  writeFileSync(path.join(d, 'desc.html'), DESC);
  return {
    d,
    worlds,
    dietpiDir,
    stats,
    nodeDir: path.join(d, 'node'),
    store: path.join(d, 'tool', 'join-page-look'),
    dest: path.join(worlds, 'curse-of-strahd', 'join-background.webp'),
    json: () => JSON.parse(readFileSync(path.join(worlds, 'curse-of-strahd', 'world.json'), 'utf8')),
    calls: () => (existsSync(path.join(d, 'calls')) ? readFileSync(path.join(d, 'calls'), 'utf8') : ''),
  };
}

function run(pi, env) {
  const script = `${lib}
NODE_DIR="${posix(pi.nodeDir)}"
TOOL_DATA="${posix(path.join(pi.d, 'tool'))}"
id() { echo 0; }
sleep() { :; }
have_systemd() { return 0; }
require_quiet() { echo "quiet-check: $*" >>"${posix(pi.d)}/calls"; }
systemctl() { echo "systemctl $*" >>"${posix(pi.d)}/calls"; case "$*" in *kit-gm*) return 1;; esac; return 0; }
runuser() { shift 3; "$@"; }
install() { local a=(); while [ $# -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) a+=("$1"); shift;; esac; done; command install "\${a[@]}"; }
curl() {
  [ -z "\${JOIN_DOWN:-}" ] || return 22
  case "$*" in
    *"-w"*) echo "\${SERVED_CODE:-200}" ;;
    *) echo '<form id="join-game"></form>'; [ -n "\${SERVED_BG-worlds/curse-of-strahd/join-background.webp}" ] && echo "background: url(\${SERVED_BG-worlds/curse-of-strahd/join-background.webp})" || true ;;
  esac
}
${stage}`;
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
  return { IMAGE_SRC: posix(src), EXPECT_SHA256: sha(content), DESC_FILE: posix(path.join(pi.d, 'desc.html')) };
}

describe('19-join-page-look.sh', () => {
  test('is valid bash', t => {
    const res = spawnSync('bash', ['-n', path.join(remote, '19-join-page-look.sh')], { encoding: 'utf8' });
    if (res.error) return t.skip('no bash here');
    assert.equal(res.status, 0, res.stderr);
  });

  test('a dry run changes nothing, stops nothing and needs no snapshot', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, { ...source(pi), DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dry run: would stop Foundry/);
    assert.equal(existsSync(pi.dest), false);
    assert.equal(pi.json().description, '<p>old</p>');
    assert.doesNotMatch(pi.calls(), /systemctl (stop|start|restart)/);
  });

  test('a real run stops Foundry first, edits only the two keys, saves the before values and starts Foundry again', () => {
    const pi = fakePi();
    const env = source(pi);
    const r = run(pi, env);
    assert.equal(r.status, 0, r.out);
    assert.equal(sha(readFileSync(pi.dest)), env.EXPECT_SHA256);
    const j = pi.json();
    assert.equal(j.background, 'worlds/curse-of-strahd/join-background.webp');
    assert.equal(j.description, DESC);
    assert.equal(j.title, 'Curse of Strahd');
    assert.equal(j.playtime, 5);
    const calls = pi.calls();
    assert.ok(calls.indexOf('stop foundry.service') < calls.indexOf('start foundry.service'), calls);
    assert.match(calls, /quiet-check: setting the join page look/);
    assert.match(calls, /start foundry-ai-tool-gm-browser.service/);
    const before = readdirSync(pi.store).find(f => f.endsWith('-before.json'));
    const saved = JSON.parse(readFileSync(path.join(pi.store, before), 'utf8'));
    assert.equal(saved.hadBackground, false);
    assert.equal(saved.description, '<p>old</p>');
  });

  test('without a snapshot from today nothing is stopped or written', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, source(pi));
    assert.notEqual(r.status, 0);
    assert.match(r.out, /snapshot/);
    assert.equal(existsSync(pi.dest), false);
    assert.doesNotMatch(pi.calls(), /systemctl (stop|start|restart)/);
    assert.equal(pi.json().description, '<p>old</p>');
  });

  test('a wrong hash, a file that is not a webp, a missing world and a missing description are refused', () => {
    const pi = fakePi();
    assert.notEqual(run(pi, { ...source(pi), EXPECT_SHA256: 'a'.repeat(64) }).status, 0);
    const r = run(pi, source(pi, Buffer.from('GIF89a not a webp file')));
    assert.notEqual(r.status, 0);
    assert.match(r.out, /not a webp/);
    assert.match(run(pi, { ...source(pi), WORLD: 'no-such-world' }).out, /no world folder/);
    assert.match(run(pi, { ...source(pi), DESC_FILE: posix(path.join(pi.d, 'missing.html')) }).out, /not a regular file/);
    assert.equal(existsSync(pi.dest), false);
    assert.doesNotMatch(pi.calls(), /systemctl (stop|start|restart)/);
  });

  test('the same picture and description again change nothing', () => {
    const pi = fakePi();
    assert.equal(run(pi, source(pi)).status, 0);
    rmSync(path.join(pi.d, 'calls'));
    const again = run(pi, source(pi));
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /nothing to change/);
    assert.doesNotMatch(pi.calls(), /systemctl (stop|start|restart)/);
  });

  test('when /join does not name the picture the run fails after the edit, with the services running', () => {
    const pi = fakePi();
    const r = run(pi, { ...source(pi), SERVED_BG: '' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not name/);
    assert.match(pi.calls(), /start foundry.service/);
  });

  test('when the join page never answers, Foundry is stopped, world.json put back, and only then Foundry started', () => {
    const pi = fakePi();
    const r = run(pi, { ...source(pi), JOIN_DOWN: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /world.json is put back/);
    const j = pi.json();
    assert.equal(j.description, '<p>old</p>');
    assert.equal('background' in j, false);
    const calls = pi.calls();
    const lastStop = calls.lastIndexOf('stop foundry.service');
    assert.ok(lastStop > calls.indexOf('start foundry.service'), calls);
    assert.ok(calls.indexOf('start foundry.service', lastStop) > lastStop, calls);
  });

  test('a second run with only a new description, then UNDO, keeps the picture the restored background names', () => {
    const pi = fakePi();
    const env = source(pi);
    assert.equal(run(pi, env).status, 0);
    writeFileSync(path.join(pi.d, 'desc.html'), '<p>second</p>');
    assert.equal(run(pi, env).status, 0);
    assert.equal(pi.json().description, '<p>second</p>');
    const r = run(pi, { EXPECT_SHA256: env.EXPECT_SHA256, UNDO: '1' });
    assert.equal(r.status, 0, r.out);
    assert.equal(pi.json().description, DESC);
    assert.equal(pi.json().background, 'worlds/curse-of-strahd/join-background.webp');
    assert.equal(existsSync(pi.dest), true);
  });

  test('a different picture on a rerun is kept, and UNDO puts it back', () => {
    const pi = fakePi();
    const first = source(pi, webp('first'));
    assert.equal(run(pi, first).status, 0);
    const second = source(pi, webp('second'));
    assert.equal(run(pi, second).status, 0);
    assert.equal(sha(readFileSync(pi.dest)), second.EXPECT_SHA256);
    assert.equal(run(pi, { EXPECT_SHA256: second.EXPECT_SHA256, UNDO: '1' }).status, 0);
    assert.equal(sha(readFileSync(pi.dest)), first.EXPECT_SHA256);
  });

  test('UNDO with no before.json says so', () => {
    const pi = fakePi();
    const r = run(pi, { EXPECT_SHA256: 'c'.repeat(64), UNDO: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /nothing to undo from/);
  });

  test('UNDO puts the old description back, drops the background and removes the picture', () => {
    const pi = fakePi();
    const env = source(pi);
    assert.equal(run(pi, env).status, 0);
    const r = run(pi, { EXPECT_SHA256: env.EXPECT_SHA256, UNDO: '1' });
    assert.equal(r.status, 0, r.out);
    const j = pi.json();
    assert.equal('background' in j, false);
    assert.equal(j.description, '<p>old</p>');
    assert.equal(existsSync(pi.dest), false);
  });

  test('odd world ids and file names are refused', () => {
    const pi = fakePi();
    assert.notEqual(run(pi, { ...source(pi), WORLD: '../x' }).status, 0);
    assert.notEqual(run(pi, { ...source(pi), DEST_NAME: '../evil.webp' }).status, 0);
  });
});
