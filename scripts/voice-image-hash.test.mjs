// voice-image-hash.ps1: the source hash that voice-stack.ps1 compares with the label on the voice
// images. No Docker: the hash runs on temp folders and the comparison is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, 'voice-image-hash.ps1').replace(/\\/g, '/');
const pwsh = (cmd) => spawnSync('pwsh', ['-NoProfile', '-Command', `. '${lib}'; ${cmd}`], { encoding: 'utf8' });
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
const opts = { skip: !hasPwsh && 'pwsh not available' };
const hashOf = (dir) => pwsh(`Get-VoiceSourceHash -Dir '${dir.replace(/\\/g, '/')}'`).stdout.trim();

function tree() {
  const dir = mkdtempSync(join(tmpdir(), 'voice-hash-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'src', 'a.py'), 'print(1)\n');
  writeFileSync(join(dir, 'pyproject.toml'), 'x\n');
  return dir;
}

test('same sources, same hash; a source edit changes it; tests and audio do not', opts, () => {
  const dir = tree();
  try {
    const base = hashOf(dir);
    assert.match(base, /^[0-9a-f]{16}$/);
    writeFileSync(join(dir, 'tests', 't.py'), 'x');
    writeFileSync(join(dir, 'clip.wav'), 'x');
    assert.equal(hashOf(dir), base);
    writeFileSync(join(dir, 'src', 'a.py'), 'print(2)\n');
    assert.notEqual(hashOf(dir), base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a nested data folder is part of the image and changes the hash', opts, () => {
  const dir = tree();
  try {
    mkdirSync(join(dir, 'src', 'pkg', 'data'), { recursive: true });
    const base = hashOf(dir);
    writeFileSync(join(dir, 'src', 'pkg', 'data', 'words.txt'), 'x');
    assert.notEqual(hashOf(dir), base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CRLF checkout hashes like LF', opts, () => {
  const dir = tree();
  try {
    const base = hashOf(dir);
    writeFileSync(join(dir, 'src', 'a.py'), 'print(1)\r\n');
    assert.equal(hashOf(dir), base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('comparison names the images whose label differs or is missing', opts, () => {
  const r = pwsh(
    "(Compare-VoiceImageHashes -Expected @{transcriber='aa';pipeline='bb'} -Actual @{transcriber='aa';pipeline=''}) -join ','"
  );
  assert.equal(r.stdout.trim(), 'pipeline');
  const ok = pwsh("(Compare-VoiceImageHashes -Expected @{transcriber='aa'} -Actual @{transcriber='aa'}).Count");
  assert.equal(ok.stdout.trim(), '0');
});

test('voice-stack checks the labels before a transcribe job and the Dockerfiles carry them', () => {
  const stack = readFileSync(join(here, 'voice-stack.ps1'), 'utf8');
  assert.match(stack, /Get-StaleVoiceImages \$expected[\s\S]*Enter-GpuLock/, 'stale check runs before the GPU lock');
  for (const d of ['transcriber', 'session-pipeline']) {
    const df = readFileSync(join(here, '..', 'tools', d, 'Dockerfile'), 'utf8');
    assert.match(df, /LABEL fvtt\.source-hash=\$SOURCE_HASH/);
  }
  const compose = readFileSync(join(here, '..', 'tools', 'voice-stack', 'docker-compose.yml'), 'utf8');
  assert.match(compose, /TRANSCRIBER_SOURCE_HASH/);
  assert.match(compose, /PIPELINE_SOURCE_HASH/);
});
