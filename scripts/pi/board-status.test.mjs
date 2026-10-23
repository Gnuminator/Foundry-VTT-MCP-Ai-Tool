// Tests for Pi stage 16 (scripts/pi/remote/16-board-status.sh, backlog board-pi-status):
//   node --test scripts/pi/board-status.test.mjs
// - the hourly status script (the stage's STATUS_SCRIPT heredoc) in bash with stand-ins for systemctl and restic
//   and a real curl against a local HTTP server: the payload, the Access headers reaching the server and not the
//   output, a refused token file, a board that answers 403, a Foundry that is down;
// - the stage as text: the token checks come before any write, nothing is printed from the token file;
// - with PI_STAGE16_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the stage itself in a Debian 13
//   ARM64 container (scripts/pi/container-test/stage16-scenarios.sh).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stagePath = path.join(repo, 'scripts', 'pi', 'remote', '16-board-status.sh');
const stage = readFileSync(stagePath, 'utf8');
const posix = p => p.replace(/\\/g, '/');
const script = /<<'STATUS_SCRIPT'\n([\s\S]*?)\nSTATUS_SCRIPT\n/.exec(stage)?.[1];

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'board-status-'));
  roots.push(d);
  return d;
};

const ID = 'header = "CF-Access-Client-Id: abc123.access"';
const SECRET = 'header = "CF-Access-Client-Secret: s3cr3t-value-xyz"';

// A fake Pi folder: the token file, a restic that prints one snapshot, a systemctl that answers `show`.
function fakePi({ conf = `${ID}\n${SECRET}\n`, backupResult = 'success', started = '123456', snapshotTime = '2026-10-23T02:31:09Z' } = {}) {
  const d = tmp();
  const bin = path.join(d, 'bin');
  mkdirSync(bin);
  mkdirSync(path.join(d, 'etc'));
  if (conf !== null) writeFileSync(path.join(d, 'etc', 'board-status.conf'), conf);
  const stub = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  };
  stub('systemctl', `case "$*" in *Monotonic*) echo "${started}" ;; *) echo "${backupResult}" ;; esac`);
  stub('restic', `echo '[{"time":"${snapshotTime}","id":"deadbeef"}]'`);
  const scriptPath = path.join(d, 'board-status.sh');
  writeFileSync(scriptPath, script);
  return { d, bin, scriptPath };
}

function startBoard(status = 204) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.statusCode = status;
      res.end();
    });
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve({ seen, port: server.address().port, close: () => server.close() })),
  );
}

// spawnSync would block the event loop that runs the fake board, so the script runs async.
function run(pi, { args = [], env = {}, api = 'http://127.0.0.1:1/api/status', url = 'http://127.0.0.1:1/api/pi-status' } = {}) {
  return new Promise(resolve => {
    const child = spawn('bash', [posix(pi.scriptPath), ...args], {
      env: {
        ...process.env,
        PATH: `${posix(pi.bin)}:${process.env.PATH}`,
        FOUNDRY_STATUS_TEST: '1',
        FOUNDRY_STATUS_ETC: posix(path.join(pi.d, 'etc')),
        FOUNDRY_STATUS_NODE: posix(process.execPath),
        FOUNDRY_STATUS_DF_PATH: posix(pi.d),
        FOUNDRY_STATUS_API: api,
        FOUNDRY_STATUS_URL: url,
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => (stdout += c));
    child.stderr.on('data', c => (stderr += c));
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

async function startFoundry(body) {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/api/status`, close: () => server.close() }),
    ),
  );
}

describe('status script', () => {
  test('is found in the stage', () => {
    assert.ok(script && script.startsWith('#!/usr/bin/env bash'));
  });

  test('dry run: the payload, with Foundry up', async () => {
    const foundry = await startFoundry({ active: true, version: '14.368', system: 'dnd5e', systemVersion: '6.0.5', users: 2, world: 'curse-of-strahd' });
    const r = await run(fakePi(), { args: ['--dry-run'], api: foundry.url });
    foundry.close();
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(r.stdout);
    assert.equal(p.v, 1);
    assert.equal(p.host, 'foundry-pi');
    assert.deepEqual(p.foundry, { up: true, version: '14.368', dnd5e: '6.0.5' });
    assert.deepEqual(p.backup, { result: 'success', at: '2026-10-23T02:31:09.000Z' });
    assert.ok(Number.isFinite(Date.parse(p.sentAt)));
    assert.equal(typeof p.disk.freePercent, 'number');
    assert.deepEqual(Object.keys(p).sort(), ['backup', 'disk', 'foundry', 'host', 'sentAt', 'uptimeSeconds', 'v']);
    // No world name, user count or anything else Foundry said.
    assert.ok(!r.stdout.includes('curse'));
  });

  test('dry run: Foundry down and a failed backup are reported, not errors', async () => {
    const r = await run(fakePi({ backupResult: 'failed' }), { args: ['--dry-run'] });
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(r.stdout);
    assert.deepEqual(p.foundry, { up: false, version: null, dnd5e: null });
    assert.equal(p.backup.result, 'failed');
  });

  test('odd version strings are dropped', async () => {
    const foundry = await startFoundry({ version: '14.368 <script>', system: 'dnd5e', systemVersion: '6.0.5' });
    const r = await run(fakePi(), { args: ['--dry-run'], api: foundry.url });
    foundry.close();
    const p = JSON.parse(r.stdout);
    assert.equal(p.foundry.version, null);
    assert.equal(p.foundry.dnd5e, '6.0.5');
  });

  test('posts the payload with the Access headers; nothing secret is printed', async () => {
    const board = await startBoard(204);
    const r = await run(fakePi(), { url: `http://127.0.0.1:${board.port}/api/pi-status` });
    board.close();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(board.seen.length, 1);
    const [req] = board.seen;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/pi-status');
    assert.equal(req.headers['cf-access-client-id'], 'abc123.access');
    assert.equal(req.headers['cf-access-client-secret'], 's3cr3t-value-xyz');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(req.body).host, 'foundry-pi');
    assert.ok(!req.body.includes('s3cr3t'));
    assert.ok(!(r.stdout + r.stderr).includes('s3cr3t') && !(r.stdout + r.stderr).includes('abc123'));
  });

  test('a board that answers 403 fails the run without printing the token', async () => {
    const board = await startBoard(403);
    const r = await run(fakePi(), { url: `http://127.0.0.1:${board.port}/api/pi-status` });
    board.close();
    assert.equal(r.status, 69);
    assert.match(r.stderr, /HTTP 403/);
    assert.ok(!(r.stdout + r.stderr).includes('s3cr3t'));
  });

  test('a redirect to a login page is a failure, not a success', async () => {
    const board = await startBoard(302);
    const r = await run(fakePi(), { url: `http://127.0.0.1:${board.port}/api/pi-status` });
    board.close();
    assert.equal(r.status, 69);
  });

  test('refuses without a token file', async () => {
    const board = await startBoard(204);
    const r = await run(fakePi({ conf: null }), { url: `http://127.0.0.1:${board.port}/api/pi-status` });
    board.close();
    assert.equal(r.status, 78);
    assert.equal(board.seen.length, 0);
  });

  test('without test mode a token file that is not root 0600 is refused, whoever runs it', async () => {
    const board = await startBoard(204);
    const pi = fakePi();
    chmodSync(path.join(pi.d, 'etc', 'board-status.conf'), 0o644);
    const r = await run(pi, { env: { FOUNDRY_STATUS_TEST: '0' }, url: `http://127.0.0.1:${board.port}/api/pi-status` });
    board.close();
    assert.equal(r.status, 78);
    assert.equal(board.seen.length, 0);
  });

  test('a unit that has not run since the boot reports no result, never a green default', async () => {
    const r = await run(fakePi({ started: '0' }), { args: ['--dry-run'] });
    assert.equal(JSON.parse(r.stdout).backup.result, null);
    assert.equal(JSON.parse(r.stdout).backup.at, '2026-10-23T02:31:09.000Z');
  });

  test('a token file with a line that is not an Access header is refused every hour, a NUL byte included', async () => {
    for (const extra of ['url = "http://evil.example/"\n', 'output = "/etc/passwd"\n', '\0url = "http://evil.example/"\n']) {
      const board = await startBoard(204);
      const pi = fakePi({ conf: `${ID}\n${SECRET}\n${extra}` });
      const r = await run(pi, { url: `http://127.0.0.1:${board.port}/api/pi-status` });
      board.close();
      assert.equal(r.status, 78, JSON.stringify(extra));
      assert.equal(board.seen.length, 0);
      assert.ok(!(r.stdout + r.stderr).includes('evil'));
    }
  });
});

describe('stage text', () => {
  test('the token file is checked before anything is written', () => {
    const check = stage.indexOf('say "the token file"');
    const firstWrite = stage.indexOf('install -d');
    assert.ok(check > 0 && firstWrite > check);
    assert.ok(stage.indexOf('require_recent_snapshot') < check);
  });

  test('the token file is never printed or sourced', () => {
    assert.ok(!/\bcat\b[^\n]*\$conf|source[^\n]*\$conf|\.\s+"\$conf"/.test(stage.replace(/^#.*$/gm, '')));
    assert.ok(!/echo[^\n]*\$conf"?\s*\|/.test(stage));
  });

  test('every rm -rf has a ${var:?}', () => {
    for (const line of stage.split('\n')) {
      if (/rm\s+-[a-z]*r[a-z]*f?\s/.test(line)) assert.match(line, /\$\{[a-z_]+:\?\}/, line);
    }
  });

  test('https is the default, only test mode widens it; curl ignores ~/.curlrc; the stage greps binary-safe', () => {
    assert.match(script, /proto='=https'\n\[ "\$test_mode" = 1 \] && proto='=http,https'/);
    assert.equal((script.match(/\bcurl -q /g) || []).length, 2);
    assert.match(stage, /LC_ALL=C grep -a -nvE/);
  });

  test('no catch-up run at boot; the service waits for network and time', () => {
    assert.ok(!/Persistent=/.test(stage.replace(/^#.*$/gm, '')));
    assert.match(stage, /Wants=network-online\.target\nAfter=network-online\.target time-sync\.target/);
  });

  test('the timer is hourly', () => {
    assert.match(stage, /OnCalendar=\*-\*-\* \*:07:00/);
  });
});

const CONTAINER = process.env.PI_STAGE16_CONTAINER === '1';
describe('stage 16 in the ARM64 container', { skip: !CONTAINER }, () => {
  test('scenarios', () => {
    const r = spawnSync(
      'docker',
      ['run', '--rm', '--platform', 'linux/arm64', '-v', `${repo}:/repo:ro`, 'debian:13-slim', 'bash', '/repo/scripts/pi/container-test/stage16-scenarios.sh'],
      { encoding: 'utf8', timeout: 600000 },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
  });
});
