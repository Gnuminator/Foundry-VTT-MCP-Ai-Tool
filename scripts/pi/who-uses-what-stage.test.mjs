// Pi stage 35, the Who uses what note written by the Pi (scripts/pi/remote/35-who-uses-what.sh and scripts/pi/who-uses-what-push.sh):
//   node --test scripts/pi/who-uses-what-stage.test.mjs
// Text checks and the job against a local bare repo (real git, a stand-in dashboard) always run when bash and git exist; the
// stage scenarios (real lib.sh, runuser, ssh-keygen, cmp and install in a Debian 13 ARM64 container) run with
// PI_STAGE35_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/35-who-uses-what.sh'), 'utf8');
const job = readFileSync(path.join(repo, 'scripts/pi/who-uses-what-push.sh'), 'utf8');

describe('stage 35 as text', () => {
  test('the snapshot check comes before the first write and DRY_RUN, CHECK and UNDO exist', () => {
    const snap = stage.indexOf('require_recent_snapshot');
    const write = stage.indexOf('install -d -m 0755');
    assert.ok(snap > 0 && write > snap);
    for (const m of ['DRY_RUN', 'CHECK', 'UNDO']) assert.match(stage, new RegExp(m));
  });

  test('it restarts and stops only its own units: no require_quiet, no other service touched', () => {
    assert.doesNotMatch(stage, /require_quiet|enable_unit/);
    const code = stage
      .split('\n')
      .filter(l => !l.startsWith('#'))
      .join('\n');
    const acts = code.match(/systemctl (restart|stop|start|enable|disable)[^\n]*/g) ?? [];
    assert.ok(acts.length > 0);
    for (const r of acts) assert.match(r, /"\$unit_name\.(service|timer)"/, r);
  });

  test('every rm -rf has a guarded variable and the state folder (key, clone) is never removed', () => {
    for (const m of stage.matchAll(/rm -(rf|f) ("[^"]*")/g))
      assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
    assert.doesNotMatch(stage, /rm [^\n]*\$state/);
    assert.doesNotMatch(stage, /rm [^\n]*\$key/);
  });

  test('the private key is made by the foundry user, kept 0600, and never printed', () => {
    assert.match(stage, /as_foundry\(\) \{ runuser -u "\$FOUNDRY_USER" -- "\$@"; \}/);
    assert.match(stage, /as_foundry ssh-keygen -q -t ed25519 -N ''/);
    // root writes nothing inside the foundry-owned state folder: no redirect into $state, no root chown or chmod of its files
    const code = stage.split('\n').filter(l => !l.trim().startsWith('#'));
    for (const l of code) {
      if (/as_foundry|runuser/.test(l)) continue;
      assert.doesNotMatch(l, />\s*"?\$(state|key)/, l);
      assert.doesNotMatch(l, /(chown|chmod|printf[^\n]*>)[^\n]*\$(state|key)/, l);
    }
    assert.match(stage, /\[ ! -L "\$state" \]/);
    assert.match(stage, /chmod 0600 "\$key"/);
    assert.match(stage, /install -d -m 0700 -o "\$FOUNDRY_USER"/);
    assert.doesNotMatch(stage, /(cat|sed|echo|printf)[^\n]*"\$key"(?!\.pub)/);
    assert.doesNotMatch(stage, /GM_DASHBOARD_TOKEN=\$/);
  });

  test('the timer is enabled only after a reading was pushed', () => {
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

  test('the unit is a hardened foundry-user oneshot with one writable folder', () => {
    assert.match(stage, /^Type=oneshot$/m);
    assert.match(stage, /^User=\$FOUNDRY_USER$/m);
    assert.match(stage, /^NoNewPrivileges=true$/m);
    assert.match(stage, /^ProtectSystem=strict$/m);
    assert.match(stage, /^ReadWritePaths=\$state$/m);
    assert.doesNotMatch(stage, /^(Requires|BindsTo)=/m);
    assert.doesNotMatch(stage, /^(Environment|ExecStart)=[^\n]*(TOKEN|SECRET)/m);
  });

  test('the GitHub host key is pinned and matches the published fingerprint', () => {
    const line = stage.match(/^github_hostkey='([^']+)'$/m)?.[1];
    assert.ok(line);
    const [, type, b64] = line.split(' ');
    assert.equal(type, 'ssh-ed25519');
    const fp = createHash('sha256')
      .update(Buffer.from(b64, 'base64'))
      .digest('base64')
      .replace(/=+$/, '');
    // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
    assert.equal(fp, '+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU');
  });
});

describe('the job as text', () => {
  test('it checks the host key strictly, uses only the deploy key and never prompts', () => {
    assert.match(job, /StrictHostKeyChecking=yes/);
    assert.match(job, /IdentitiesOnly=yes/);
    assert.match(job, /BatchMode=yes/);
    assert.match(job, /GIT_TERMINAL_PROMPT=0/);
  });

  test('the token goes to the report script only, and nothing prints it', () => {
    assert.match(job, /COGM_TOKEN="\$\{GM_DASHBOARD_TOKEN:-\}" "\$node_bin"/);
    assert.doesNotMatch(job, /(echo|say|printf)[^\n]*(GM_DASHBOARD_TOKEN|COGM_TOKEN)/);
    assert.doesNotMatch(job, /set -x|bash -x/);
  });

  test('it keeps a one-file sparse clone and never force-pushes', () => {
    assert.match(job, /core\.sparseCheckout true/);
    assert.match(job, /--depth 1/);
    assert.doesNotMatch(job, /push[^\n]*(--force|-f\b|\+)/);
  });
});

const haveBash = spawnSync('bash', ['-c', 'git --version'], { encoding: 'utf8' }).status === 0;

describe('the job against a local bare repo', { skip: !haveBash }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wuw-job-'));
  const fwd = p => p.replace(/\\/g, '/');
  const report = {
    days: 7,
    current: 3,
    generatedAt: '2026-11-19T20:00:00.000Z',
    people: [],
    tools: { used: 0, neverCalled: [], errorRates: [] },
  };
  let seenToken = null;
  let status = 200;
  const server = http.createServer((req, res) => {
    seenToken = req.headers['x-cogm-token'] ?? null;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 200 ? JSON.stringify(report) : '{}');
  });
  let port = 0;
  const git = (cwd, ...a) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
      cwd,
      encoding: 'utf8',
    });
  const bare = path.join(root, 'vault.git');
  const work = path.join(root, 'state');

  test('setup', async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git(bare, 'config', 'uploadpack.allowFilter', 'true');
    git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const seed = path.join(root, 'seed');
    mkdirSync(path.join(seed, 'Dev/Foundry AI Tool'), { recursive: true });
    writeFileSync(path.join(seed, 'Dev/Foundry AI Tool/Backlog.md'), 'backlog\n');
    writeFileSync(path.join(seed, 'Secret.md'), 'private\n');
    git(seed, 'init', '-q', '-b', 'main');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'seed');
    assert.equal(git(seed, 'push', '-q', bare, 'main').status, 0);
  });

  // Async: the stand-in dashboard lives in this process, so a blocking spawn would starve it.
  const run = (extra = {}) =>
    new Promise(resolve => {
      const child = spawn('bash', [fwd(path.join(repo, 'scripts/pi/who-uses-what-push.sh'))], {
        env: {
          ...process.env,
          WUW_DIR: fwd(work),
          WUW_NODE: fwd(process.execPath),
          WUW_SCRIPT: fwd(path.join(repo, 'scripts/who-uses-what.mjs')),
          WUW_DASHBOARD: `http://127.0.0.1:${port}`,
          WUW_REMOTE: fwd(bare),
          WUW_SSH_PLAIN: '1',
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
  const show = p => git(bare, 'show', `main:${p}`).stdout;
  const count = () => Number(git(bare, 'rev-list', '--count', 'main').stdout.trim());

  test('a first run pushes the note, sends the token, leaves the rest of the vault out of the clone, prints no token', async () => {
    const r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(show('Dev/Foundry AI Tool/Who uses what.md'), /^# Who uses what/);
    assert.equal(seenToken, 'sekrit-token-123');
    const clone = path.join(work, 'repo');
    assert.ok(existsSync(path.join(clone, 'Dev/Foundry AI Tool/Who uses what.md')));
    assert.ok(!existsSync(path.join(clone, 'Secret.md')), 'the sparse clone holds only the note');
    // Not only the working tree: the object store must not hold the other notes' content either (blobless fetch).
    const blob = git(bare, 'rev-parse', 'main:Secret.md').stdout.trim();
    const have = spawnSync('git', ['-C', clone, 'cat-file', '-e', blob], {
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    });
    assert.notEqual(have.status, 0, 'the clone holds the content of another note');
    assert.ok(!(r.stdout + r.stderr).includes('sekrit-token-123'));
    assert.equal(git(bare, 'log', '-1', '--format=%an', 'main').stdout.trim(), 'foundry-pi');
  });

  test('an unchanged note makes no commit; a changed report makes one', async () => {
    const n = count();
    const r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /unchanged/);
    assert.equal(count(), n);
    report.generatedAt = '2026-11-20T00:00:00.000Z';
    const r2 = await run();
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(count(), n + 1);
    assert.match(show('Dev/Foundry AI Tool/Who uses what.md'), /2026-11-20 00:00/);
    assert.equal(show('Secret.md'), 'private\n');
  });

  test('the vault moving between runs is fetched, not overwritten', async () => {
    const other = path.join(root, 'other');
    spawnSync('git', ['clone', '-q', bare, other]);
    writeFileSync(path.join(other, 'Waiting.md'), 'waiting\n');
    git(other, 'add', '.');
    git(other, 'commit', '-q', '-m', 'pc');
    git(other, 'push', '-q', 'origin', 'main');
    report.generatedAt = '2026-11-20T04:00:00.000Z';
    const r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(show('Waiting.md'), 'waiting\n');
    assert.match(show('Dev/Foundry AI Tool/Who uses what.md'), /2026-11-20 04:00/);
  });

  test('a refused first push is retried once; two refusals fail the run', async () => {
    const hook = path.join(bare, 'hooks/pre-receive');
    const flag = fwd(path.join(root, 'refuse-once'));
    writeFileSync(
      hook,
      `#!/bin/sh\nif [ -f "${flag}" ]; then rm -f "${flag}"; echo no >&2; exit 1; fi\n`,
      { mode: 0o755 }
    );
    writeFileSync(path.join(root, 'refuse-once'), '');
    report.generatedAt = '2026-11-20T08:00:00.000Z';
    const r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /trying once more/);
    assert.match(show('Dev/Foundry AI Tool/Who uses what.md'), /2026-11-20 08:00/);
    writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    report.generatedAt = '2026-11-20T12:00:00.000Z';
    const r2 = await run();
    assert.notEqual(r2.status, 0);
    assert.match(r2.stderr, /refused twice/);
    rmSync(hook);
  });

  test('a dashboard that refuses pushes nothing and fails', async () => {
    const n = count();
    status = 401;
    const r = await run();
    status = 200;
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no report/);
    assert.equal(count(), n);
  });

  test('WUW_MODE=check reads and lists, and writes nothing', async () => {
    const n = count();
    report.generatedAt = '2026-11-20T16:00:00.000Z';
    const r = await run({ WUW_MODE: 'check' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /vault repo answers/);
    assert.equal(count(), n);
    const bad = await run({ WUW_MODE: 'check', WUW_REMOTE: fwd(path.join(root, 'nope.git')) });
    assert.notEqual(bad.status, 0);
  });

  after(() => {
    server.close();
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
