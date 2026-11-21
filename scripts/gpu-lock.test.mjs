// gpu-lock-run.ps1 and voice-stack.ps1 transcribe: the GPU lock is taken around the job, released
// in a finally, and a held lock refuses with the holder's name. No GPU is used: the job is a stub
// and the lock lives in a temp folder (-Root).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'gpu-lock-run.ps1');
const lockScript = join(here, 'test-env', 'lock.ps1');

const pwsh = (args) => spawnSync('pwsh', ['-NoProfile', ...args], { encoding: 'utf8' });
const hasPwsh = pwsh(['-Command', 'exit 0']).status === 0;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'gpu-lock-'));
  const root = join(dir, 'lock');
  spawnSync('pwsh', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force '${root}' | Out-Null`]);
  const marker = join(dir, 'ran.txt');
  const job = join(dir, 'job.ps1');
  // The job records whether the lock was held while it ran, then exits with the code it is given.
  writeFileSync(
    job,
    `param([int]$Code = 0)
$held = (Get-Content -Raw '${join(root, 'lock.json').replace(/\\/g, '/')}') -match 'gpu-job-'
Set-Content '${marker.replace(/\\/g, '/')}' "held=$held"
exit $Code
`
  );
  return { dir, root, marker, job };
}

const run = (root, job, ...jobArgs) =>
  pwsh(['-File', runner, '-Holder', 'test job', '-Root', root, '-Script', job, '-ArgsJson', JSON.stringify(jobArgs.map(Number))]);
const status = (root) => pwsh(['-File', lockScript, 'status', '-Server', 'GPU', '-Root', root]).stdout;

test('takes the lock for the job and releases it after', { skip: !hasPwsh }, () => {
  const { dir, root, marker, job } = setup();
  try {
    const r = run(root, job);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(marker, 'utf8').trim(), 'held=True');
    assert.match(status(root), /free/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releases the lock when the job fails and passes its exit code on', { skip: !hasPwsh }, () => {
  const { dir, root, job } = setup();
  try {
    const r = run(root, job, '7');
    assert.equal(r.status, 7);
    assert.match(status(root), /free/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses with the holder named and does not start the job', { skip: !hasPwsh }, () => {
  const { dir, root, marker, job } = setup();
  try {
    const t = pwsh([
      '-File', lockScript, 'take', '-Server', 'GPU', '-Root', root,
      '-Holder', 'Blender render lane', '-Session', 'someone-else', '-Purpose', 'render',
    ]);
    assert.equal(t.status, 0, t.stderr);
    const r = run(root, job);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /The GPU is in use/);
    assert.match(r.stderr, /Blender render lane/);
    assert.equal(existsSync(marker), false, 'the job must not have started');
    assert.match(status(root), /held by Blender render lane/, 'the other holder keeps the lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('voice-stack transcribe and the dashboard voice both go through the GPU lock', () => {
  const stack = readFileSync(join(here, 'voice-stack.ps1'), 'utf8');
  assert.match(stack, /Enter-GpuLock/);
  assert.match(stack, /finally\s*\{\s*Exit-GpuLock/);
  const route = readFileSync(
    join(here, '..', 'packages', 'cogm-dashboard', 'src', 'previously-on-route.ts'),
    'utf8'
  );
  assert.match(route, /gpu-lock-run\.ps1/);
  assert.match(route, /GPU_LOCK_RUN,/);
});
