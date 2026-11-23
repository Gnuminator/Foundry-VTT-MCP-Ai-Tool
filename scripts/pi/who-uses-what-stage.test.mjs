// Pi stage 35, the Who uses what reading sent to the PM board (scripts/pi/remote/35-who-uses-what.sh and
// scripts/pi/who-uses-what-push.sh):
//   node --test scripts/pi/who-uses-what-stage.test.mjs
// Text checks and the job against stand-in dashboard and board servers always run when bash and curl exist; the stage
// scenarios (real lib.sh, cmp and install in a Debian 13 ARM64 container) run with PI_STAGE35_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/35-who-uses-what.sh'), 'utf8');
const job = readFileSync(path.join(repo, 'scripts/pi/who-uses-what-push.sh'), 'utf8');
const code = text =>
  text
    .split('\n')
    .filter(l => !l.trim().startsWith('#'))
    .join('\n');

describe('stage 35 as text', () => {
  test('the snapshot check comes before the first write and DRY_RUN, CHECK and UNDO exist', () => {
    const snap = stage.indexOf('require_recent_snapshot');
    const write = stage.indexOf('install -d -m 0755');
    assert.ok(snap > 0 && write > snap);
    for (const m of ['DRY_RUN', 'CHECK', 'UNDO']) assert.match(stage, new RegExp(m));
  });

  test('it restarts and stops only its own units: no require_quiet, no other service touched', () => {
    assert.doesNotMatch(stage, /require_quiet|enable_unit/);
    const acts = code(stage).match(/systemctl (restart|stop|start|enable|disable)[^\n]*/g) ?? [];
    assert.ok(acts.length > 0);
    for (const r of acts) assert.match(r, /"\$unit_name\.(service|timer)"/, r);
  });

  test('every rm -rf has a guarded variable', () => {
    for (const m of stage.matchAll(/rm -(rf|f) ("[^"]*")/g))
      assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
  });

  test('no key to the vault repo: no ssh-keygen, no deploy key, no git, no GitHub host key', () => {
    for (const text of [code(stage), code(job)]) {
      assert.doesNotMatch(text, /ssh-keygen|id_ed25519|known_hosts|github_hostkey|git@github/);
      assert.doesNotMatch(text, /\bgit\b/);
      assert.doesNotMatch(text, /obsidian-vault\.git/);
    }
  });

  test('the old deploy key folder is removed, never followed through a link', () => {
    assert.match(stage, /\[ ! -L "\$legacy_state" \]/);
    assert.match(stage, /rm -rf "\$\{legacy_state:\?\}"/);
  });

  test('the timer is enabled only after a reading was sent', () => {
    const start = stage.indexOf('systemctl start "$unit_name.service"');
    const enable = stage.indexOf('systemctl enable --now "$unit_name.timer"');
    assert.ok(start > 0 && enable > start);
    assert.match(stage, /the timer is NOT enabled/);
  });

  test('the schedule is every 4 hours and Sunday 23:00, with no catch-up run', () => {
    assert.match(stage, /^OnCalendar=\*-\*-\* 00\/4:25:00$/m);
    assert.match(stage, /^OnCalendar=Sun \*-\*-\* 23:00:00$/m);
    assert.match(stage, /^Persistent=false$/m);
  });

  test('the unit is a sandboxed oneshot with no writable path and no secret in it', () => {
    assert.match(stage, /^Type=oneshot$/m);
    assert.match(stage, /^NoNewPrivileges=true$/m);
    assert.match(stage, /^ProtectSystem=strict$/m);
    assert.doesNotMatch(stage, /^ReadWritePaths=/m);
    assert.doesNotMatch(stage, /^(Requires|BindsTo)=/m);
    assert.doesNotMatch(stage, /^(Environment|ExecStart)=[^\n]*(TOKEN|SECRET)/m);
  });

  test('the token file gets the stage 16 checks: root-only, no link, header lines only', () => {
    assert.match(stage, /"\$\(stat -c '%u %a' "\$board_conf"\)" = "0 600"/);
    assert.match(stage, /\[ ! -L "\$board_conf" \]/);
    assert.match(stage, /CF-Access-Client-\(Id\|Secret\)/);
    const check = stage.indexOf('check_board_conf\nok ');
    assert.ok(check > 0 && check < stage.indexOf('install -d -m 0755'));
  });
});

describe('the job as text', () => {
  test('it posts over https only to the board, with the token file read by curl -K', () => {
    assert.match(job, /url="\$\{WUW_URL:-https:\/\/board\.spennerit\.com\/api\/who-uses-what\}"/);
    assert.match(job, /proto='=https'/);
    assert.match(job, /-K "\$conf"/);
    assert.match(job, /curl -q /);
  });

  test('the dashboard token goes to the report script only, and nothing prints a token', () => {
    assert.match(job, /COGM_TOKEN="\$\{GM_DASHBOARD_TOKEN:-\}" "\$node_bin"/);
    assert.doesNotMatch(job, /(echo|say|printf)[^\n]*(GM_DASHBOARD_TOKEN|COGM_TOKEN)/);
    assert.doesNotMatch(job, /set -x|bash -x/);
    assert.doesNotMatch(job, /-H [^\n]*CF-Access/);
  });
});

const haveBash = spawnSync('bash', ['-c', 'curl --version'], { encoding: 'utf8' }).status === 0;

describe('the job against stand-in servers', { skip: !haveBash }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wuw-job-'));
  const fwd = p => p.replace(/\\/g, '/');
  const report = {
    schema: 1,
    days: 7,
    current: '0.31.0',
    generatedAt: '2026-11-21T20:00:00.000Z',
    people: [],
    tools: { used: 0, neverCalled: [], errorRates: [] },
  };
  let dashStatus = 200;
  let seenDashToken = null;
  let boardStatus = 200;
  const posts = [];
  const dashboard = http.createServer((req, res) => {
    seenDashToken = req.headers['x-cogm-token'] ?? null;
    res.writeHead(dashStatus, { 'content-type': 'application/json' });
    res.end(dashStatus === 200 ? JSON.stringify(report) : '{}');
  });
  const board = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      posts.push({
        method: req.method,
        url: req.url,
        type: req.headers['content-type'],
        id: req.headers['cf-access-client-id'] ?? null,
        secret: req.headers['cf-access-client-secret'] ?? null,
        body,
      });
      res.writeHead(boardStatus, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  let dashPort = 0;
  let boardPort = 0;
  const conf = path.join(root, 'board-status.conf');

  test('setup', async () => {
    await new Promise(r => dashboard.listen(0, '127.0.0.1', r));
    await new Promise(r => board.listen(0, '127.0.0.1', r));
    dashPort = dashboard.address().port;
    boardPort = board.address().port;
    writeFileSync(
      conf,
      '# test token\nheader = "CF-Access-Client-Id: id123.access"\nheader = "CF-Access-Client-Secret: secret456"\n'
    );
  });

  // Async: the stand-in servers live in this process, so a blocking spawn would starve them.
  const run = (extra = {}) =>
    new Promise(resolve => {
      const child = spawn('bash', [fwd(path.join(repo, 'scripts/pi/who-uses-what-push.sh'))], {
        env: {
          ...process.env,
          WUW_NODE: fwd(process.execPath),
          WUW_SCRIPT: fwd(path.join(repo, 'scripts/who-uses-what.mjs')),
          WUW_DASHBOARD: `http://127.0.0.1:${dashPort}`,
          WUW_URL: `http://127.0.0.1:${boardPort}/api/who-uses-what`,
          WUW_CONF: fwd(conf),
          WUW_TEST: '1',
          GM_DASHBOARD_TOKEN: 'sekrit-token-123',
          ...extra,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => (stdout += d));
      child.stderr.on('data', d => (stderr += d));
      child.on('close', status => resolve({ status, stdout, stderr }));
    });

  test('a run posts the report JSON with the Access headers and sends the GM token to the dashboard only', async () => {
    posts.length = 0;
    const r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(posts.length, 1);
    const [p] = posts;
    assert.equal(p.method, 'POST');
    assert.equal(p.url, '/api/who-uses-what');
    assert.match(p.type, /^application\/json/);
    assert.equal(p.id, 'id123.access');
    assert.equal(p.secret, 'secret456');
    assert.deepEqual(JSON.parse(p.body), report);
    assert.equal(seenDashToken, 'sekrit-token-123');
    assert.ok(!p.body.includes('sekrit-token-123'));
    assert.match(r.stdout, /posted the reading to the board/);
    const all = r.stdout + r.stderr;
    assert.ok(!all.includes('sekrit-token-123') && !all.includes('secret456'));
  });

  test('a board that refuses fails the run without printing the token', async () => {
    boardStatus = 403;
    const r = await run();
    boardStatus = 200;
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /board answered HTTP 403/);
    assert.ok(!(r.stdout + r.stderr).includes('secret456'));
  });

  test('a dashboard that refuses posts nothing and fails', async () => {
    posts.length = 0;
    dashStatus = 401;
    const r = await run();
    dashStatus = 200;
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no report/);
    assert.equal(posts.length, 0);
  });

  test('a token file that holds anything but Access headers is refused before anything is sent', async () => {
    posts.length = 0;
    const bad = path.join(root, 'bad.conf');
    writeFileSync(bad, 'header = "CF-Access-Client-Id: a"\noutput = "/etc/passwd"\n');
    const r = await run({ WUW_CONF: fwd(bad) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not an Access header/);
    assert.ok(!r.stderr.includes('/etc/passwd'));
    assert.equal(posts.length, 0);
  });

  test('an unreachable board fails', async () => {
    const r = await run({ WUW_URL: 'http://127.0.0.1:9/api/who-uses-what' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /could not reach the board/);
  });

  test('http is refused without the test switch', async () => {
    posts.length = 0;
    const r = await run({ WUW_TEST: '0' });
    assert.notEqual(r.status, 0);
    assert.equal(posts.length, 0);
  });

  test('WUW_MODE=check reads the report and posts nothing', async () => {
    posts.length = 0;
    const r = await run({ WUW_MODE: 'check' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /nothing posted/);
    assert.equal(posts.length, 0);
  });

  after(() => {
    dashboard.close();
    board.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe(
  'stage 35 in the ARM64 container',
  { skip: process.env.PI_STAGE35_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage35-scenarios.sh', { timeout: 600000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
