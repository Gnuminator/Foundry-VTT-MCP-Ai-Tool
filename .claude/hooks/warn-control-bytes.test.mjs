// Tests for warn-control-bytes.mjs:  node --test .claude/hooks/warn-control-bytes.test.mjs
// Mangled fixtures: a backspace (\x08) where a regex word boundary `\b` was meant, as the shell
// and python edits of 2026-09/10 wrote them.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bestMs } from './best-ms.mjs';
import { checkFile, controlBytes, run } from './warn-control-bytes.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'warn-control-bytes.mjs');
const BS = String.fromCharCode(8);
const ESC = String.fromCharCode(27);
const MANGLED = `const re = /${BS}board${BS}/;\n`;
const CLEAN = 'const re = /\\bboard\\b/;\n\tline\r\n';

let repo;
const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore' });
const put = (name, text) => {
  mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  writeFileSync(path.join(repo, name), text);
};

before(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'warn-control-bytes-'));
  git('init', '-q');
  put('clean.ts', CLEAN);
  put('fixture-with-esc.ts', `const a = "${ESC}[31m";\n`);
  put('tracked.mjs', CLEAN);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});

after(() => rmSync(repo, { recursive: true, force: true }));

const write = (file, extra = {}) => ({
  tool_name: 'Write',
  cwd: repo,
  tool_input: { file_path: path.join(repo, file) },
  ...extra,
});

test('controlBytes finds everything but tab, LF and CR', () => {
  assert.deepEqual(controlBytes(Buffer.from(CLEAN)), []);
  assert.deepEqual(controlBytes(Buffer.from(MANGLED)), [12, 18]);
  assert.deepEqual(controlBytes(Buffer.from(`a${ESC}b\x00c\x7f`)), [1, 3, 5]);
  assert.deepEqual(controlBytes(Buffer.from('ünïcode ✓\n')), []);
});

test('Write and Edit of a file with a backspace warn, naming the line', () => {
  put('mangled.ts', `ok\n${MANGLED}`);
  for (const tool_name of ['Write', 'Edit']) {
    const out = JSON.parse(run(write('mangled.ts', { tool_name })));
    assert.match(out.systemMessage, /mangled\.ts/);
    assert.match(out.systemMessage, /\\x08 at line 2/);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /Edit tool/);
  }
});

test('clean files, tabs, CRLF and non-source files stay quiet', () => {
  put('fine.ts', CLEAN);
  put('image.png', MANGLED);
  assert.equal(run(write('fine.ts')), '');
  assert.equal(run(write('image.png')), '');
  assert.equal(run(write('does-not-exist.ts')), '');
});

test('a file that already had control bytes at HEAD warns only when it gains more', () => {
  assert.equal(run(write('fixture-with-esc.ts')), '');
  put('fixture-with-esc.ts', `const a = "${ESC}[31m";\nconst b = /${BS}x/;\n`);
  const out = JSON.parse(run(write('fixture-with-esc.ts')));
  assert.match(out.systemMessage, /fixture-with-esc\.ts: 2 /);
  put('fixture-with-esc.ts', `const a = "${ESC}[31m";\n`);
});

test('Bash: a file named in the command is checked', () => {
  put('named.json', `{"re": "${BS}d+"}\n`);
  const out = JSON.parse(
    run({ tool_name: 'Bash', cwd: repo, tool_input: { command: "sed -i 's/a/b/' named.json" } })
  );
  assert.match(out.systemMessage, /named\.json/);
});

test('Bash: a tracked file modified in the last minute is found by git, even when the command names no file', () => {
  put('tracked.mjs', MANGLED);
  const cmd = { tool_name: 'Bash', cwd: repo, tool_input: { command: 'python fix.py' } };
  assert.match(JSON.parse(run(cmd)).systemMessage, /tracked\.mjs/);
  // A command that cannot write is not checked at all.
  assert.equal(run({ ...cmd, tool_input: { command: 'git status --short' } }), '');
  // An old modification is not blamed on this command.
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(path.join(repo, 'tracked.mjs'), old, old);
  assert.equal(run(cmd), '');
  put('tracked.mjs', CLEAN);
});

test('L1: the HEAD lookup works from a subdirectory cwd and from another repo', () => {
  put('sub/deep.ts', `const a = "${ESC}[31m";\n`);
  put('sub/clean.ts', CLEAN);
  git('add', '-A');
  git('commit', '-q', '-m', 'sub');
  // already had the byte at HEAD: quiet with the session cwd at the root or in the subdirectory
  assert.equal(run(write('sub/deep.ts')), '');
  assert.equal(run({ ...write('sub/deep.ts'), cwd: path.join(repo, 'sub') }), '');
  // a second repo (the vault) is looked up in its own repo, not the session's
  const other = mkdtempSync(path.join(os.tmpdir(), 'warn-control-bytes-other-'));
  try {
    const og = (...args) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: other, stdio: 'ignore' });
    og('init', '-q');
    writeFileSync(path.join(other, 'note.md'), `x${ESC}\n`);
    og('add', '-A');
    og('commit', '-q', '-m', 'n');
    assert.equal(run({ tool_name: 'Write', cwd: repo, tool_input: { file_path: path.join(other, 'note.md') } }), '');
    writeFileSync(path.join(other, 'note.md'), `x${ESC}${BS}\n`);
    assert.match(
      JSON.parse(run({ tool_name: 'Write', cwd: repo, tool_input: { file_path: path.join(other, 'note.md') } })).systemMessage,
      /note\.md: 2 /
    );
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
  put('sub/deep.ts', `const a = "${ESC}[31m";\nconst b = /${BS}/;\n`);
  assert.match(JSON.parse(run({ ...write('sub/deep.ts'), cwd: path.join(repo, 'sub') })).systemMessage, /deep\.ts: 2 /);
  put('sub/deep.ts', `const a = "${ESC}[31m";\n`);
});

test('M4: a 200 KB single token or minified command is answered fast, and long tokens are not paths', () => {
  const cmds = [
    'a'.repeat(200_000),
    `python -c "${'f(a,b);'.repeat(30_000)}"`,
    `echo ${'a.a'.repeat(60_000)}`,
    `sed -i ${'x'.repeat(100_000)}.ts`,
  ];
  for (const command of cmds) {
    const ms = bestMs(
      () => assert.equal(run({ tool_name: 'Bash', cwd: repo, tool_input: { command } }), ''),
      500
    );
    assert.ok(ms < 500, `${command.slice(0, 20)}... took ${ms.toFixed(0)} ms`);
  }
});

test('a quoted path with spaces is found whole; many quotes stay fast', () => {
  put('with space/spaced file.md', `x${BS}\n`);
  const q = path.join(repo, 'with space', 'spaced file.md');
  const out = JSON.parse(run({ tool_name: 'Bash', cwd: repo, tool_input: { command: `sed -i 's/a/b/' "${q}"` } }));
  assert.match(out.systemMessage, /spaced file\.md/);
  const ms = bestMs(() => {
    assert.equal(run({ tool_name: 'Bash', cwd: repo, tool_input: { command: `echo ${"'a\"".repeat(60_000)}` } }), '');
    assert.equal(run({ tool_name: 'Bash', cwd: repo, tool_input: { command: `echo ${'"a b '.repeat(40_000)}` } }), '');
  }, 1000);
  assert.ok(ms < 1000, `quotes took ${ms.toFixed(0)} ms`);
});

test('a command naming many files checks only the first 200', () => {
  put('many.ts', MANGLED);
  const filler = Array.from({ length: 300 }, (_, i) => `f${i}.ts`).join(' ');
  assert.equal(run({ tool_name: 'Bash', cwd: repo, tool_input: { command: `cat ${filler} many.ts` } }), '');
  assert.match(JSON.parse(run({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'cat many.ts' } })).systemMessage, /many\.ts/);
});

test('PowerShell commands are checked like Bash', () => {
  put('ps.ps1', `Write-Host '${BS}'\n`);
  const out = JSON.parse(
    run({ tool_name: 'PowerShell', cwd: repo, tool_input: { command: "Set-Content ps.ps1 -Value 'x'" } })
  );
  assert.match(out.systemMessage, /ps\.ps1/);
});

test('other tools, junk and missing fields are silent', () => {
  assert.equal(run({ tool_name: 'Read', cwd: repo, tool_input: { file_path: path.join(repo, 'mangled.ts') } }), '');
  assert.equal(run(null), '');
  assert.equal(run({}), '');
  assert.equal(run({ tool_name: 'Write' }), '');
  assert.equal(checkFile('Z:/no/such/file.ts'), null);
});

test('entry point: payload on stdin, JSON or nothing out, never a failure', () => {
  put('entry.ts', MANGLED);
  const go = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const bad = go(JSON.stringify(write('entry.ts')));
  assert.equal(bad.status, 0);
  assert.match(JSON.parse(bad.stdout).systemMessage, /entry\.ts/);
  assert.equal(go(JSON.stringify(write('fine.ts'))).stdout, '');
  assert.equal(go('not json').status, 0);
  assert.equal(go('').stdout, '');
});
