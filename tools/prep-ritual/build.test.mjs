// node --test tools/prep-ritual/build.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { frontMatter } from '../gm-coach/build.mjs';
import { SKILL_NAME, build } from './build.mjs';

test('SKILL.md front matter fits what claude.ai accepts', () => {
  const { name, description } = frontMatter(
    readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')
  );
  assert.equal(name, SKILL_NAME);
  assert.ok(description && description.length <= 200, `description is ${description?.length}`);
});

test('build writes the folder and the zip', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prep-ritual-'));
  try {
    const { folder, zipFile } = build(dir);
    assert.ok(existsSync(path.join(folder, 'SKILL.md')));
    assert.ok(readFileSync(zipFile).readUInt32LE(0) === 0x04034b50, 'a zip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
