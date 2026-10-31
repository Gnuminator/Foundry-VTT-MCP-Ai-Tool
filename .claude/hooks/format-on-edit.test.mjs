// Tests for the prettier-on-edit hook (format-on-edit.mjs): which files it formats, that it
// formats them, and that every failure stays silent. Uses a throwaway repo root with its own
// .prettierrc and this checkout's prettier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, formatEdited, targetOf } from './format-on-edit.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'format-on-edit.mjs');
const hasPrettier = existsSync(
  path.join(REPO_ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs')
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'format-on-edit-test-'));
  writeFileSync(path.join(root, '.prettierrc'), '{"singleQuote": true, "semi": true}\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const edit = (root, file, extra = {}) => ({
  tool_name: 'Edit',
  cwd: root,
  tool_input: { file_path: file },
  ...extra,
});

test('targetOf: source files inside the repo only', () => {
  const root = path.join(os.tmpdir(), 'fmt-root');
  const ok = ['a.ts', 'src/b.tsx', 'c.js', 'd.mjs', 'e.json', 'f.md'];
  for (const f of ok) {
    assert.ok(targetOf(edit(root, path.join(root, f)), root), f);
    assert.ok(targetOf(edit(root, f), root), `relative ${f}`);
  }
  assert.equal(targetOf(edit(root, path.join(root, 'a.ps1')), root), null);
  assert.equal(targetOf(edit(root, path.join(root, 'a.css')), root), null);
  assert.equal(targetOf(edit(root, path.join(root, 'node_modules', 'x', 'a.js')), root), null);
  assert.equal(targetOf(edit(root, path.join(root, 'dist', 'a.js')), root), null);
  assert.equal(targetOf(edit(root, path.join(os.tmpdir(), 'elsewhere', 'a.ts')), root), null);
  assert.equal(targetOf(edit(root, path.join(`${root}-vault`, 'a.md')), root), null);
  assert.equal(targetOf({ tool_input: {} }, root), null);
  assert.equal(targetOf(null, root), null);
});

test(
  'formatEdited: a messy .ts and .json file are formatted, other files and outside paths are not',
  { skip: !hasPrettier },
  () => {
    const { root, cleanup } = fixture();
    try {
      const ts = path.join(root, 'a.ts');
      writeFileSync(ts, 'const a = "x"\nfunction f( ){return   1}\n');
      assert.equal(formatEdited(edit(root, ts), root, REPO_ROOT), true);
      assert.equal(readFileSync(ts, 'utf8'), "const a = 'x';\nfunction f() {\n  return 1;\n}\n");

      const json = path.join(root, 'b.json');
      writeFileSync(json, '{"a":1,\n"b":[1,2]}');
      assert.equal(formatEdited(edit(root, json), root, REPO_ROOT), true);
      assert.equal(readFileSync(json, 'utf8'), '{ "a": 1, "b": [1, 2] }\n');

      const sh = path.join(root, 'c.sh');
      writeFileSync(sh, 'echo   hi\n');
      assert.equal(formatEdited(edit(root, sh), root, REPO_ROOT), false);
      assert.equal(readFileSync(sh, 'utf8'), 'echo   hi\n');
    } finally {
      cleanup();
    }
  }
);

test(
  'formatEdited: a syntax error leaves the file alone, a missing file or prettier is silent',
  { skip: !hasPrettier },
  () => {
    const { root, cleanup } = fixture();
    try {
      const bad = path.join(root, 'bad.ts');
      writeFileSync(bad, 'const = = ;\n');
      assert.equal(formatEdited(edit(root, bad), root, REPO_ROOT), false);
      assert.equal(readFileSync(bad, 'utf8'), 'const = = ;\n');
      assert.equal(formatEdited(edit(root, path.join(root, 'missing.ts')), root, REPO_ROOT), false);
      const ok = path.join(root, 'ok.ts');
      writeFileSync(ok, 'const  a=1\n');
      assert.equal(formatEdited(edit(root, ok), root, path.join(root, 'no-prettier-here')), false);
      assert.equal(readFileSync(ok, 'utf8'), 'const  a=1\n');
    } finally {
      cleanup();
    }
  }
);

test('the hook process: exits 0 and prints nothing, also on garbage stdin', () => {
  const { root, cleanup } = fixture();
  try {
    mkdirSync(path.join(root, 'sub'));
    copyFileSync(HOOK, path.join(root, 'sub', 'keep.txt'));
    for (const stdin of [JSON.stringify(edit(root, path.join(root, 'x.ts'))), 'not json', '']) {
      const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  } finally {
    cleanup();
  }
});
