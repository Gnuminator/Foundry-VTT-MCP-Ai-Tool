// node --test tools/dnd-helper/build.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { frontMatter } from '../gm-coach/build.mjs';
import { SKILL_NAME, build } from './build.mjs';

/** The entries of a zip written by the build (no data descriptors, no zip64). */
function readZip(buf) {
  const entries = new Map();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const packedSize = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen + extraLen;
    entries.set(name, inflateRawSync(buf.subarray(start, start + packedSize)).toString('utf8'));
    at = start + packedSize;
  }
  return entries;
}

const skillText = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8');

test('SKILL.md front matter fits what claude.ai accepts', () => {
  const { name, description } = frontMatter(skillText);
  assert.equal(name, SKILL_NAME);
  assert.ok(name.length <= 64, 'name is at most 64 characters');
  assert.ok(
    description && description.length <= 200,
    `description is ${description?.length} characters, at most 200`
  );
});

test('the build writes the folder and a zip with the skill folder at its root', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-'));
  try {
    const { zipFile, files } = build(out);
    assert.ok(existsSync(path.join(out, SKILL_NAME, 'SKILL.md')));
    const entries = readZip(readFileSync(zipFile));
    assert.equal(entries.size, files.size);
    for (const name of entries.keys()) assert.ok(name.startsWith(`${SKILL_NAME}/`), name);
    assert.equal(entries.get(`${SKILL_NAME}/SKILL.md`), files.get('SKILL.md'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('every page SKILL.md names is in the skill', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-'));
  try {
    const { files } = build(out);
    const named = [...skillText.matchAll(/`(references\/[^`]+\.md)`/g)].map(m => m[1]);
    assert.ok(named.length >= 7);
    for (const name of named) assert.ok(files.has(name), `${name} is in the skill`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the skill is advise-only: no write tool is named as a step', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-'));
  try {
    const { files } = build(out);
    for (const [name, text] of files) {
      if (name.startsWith('references/player/')) continue;
      assert.doesNotMatch(
        text,
        /`(plan-actor-change|apply-planned-change|dnd5e-add-feature|dnd5e-add-features-from-compendium|create-actor-from-compendium)`/,
        `${name} names a write tool`
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
