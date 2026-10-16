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
