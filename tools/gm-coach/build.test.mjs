// node --test tools/gm-coach/build.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { SKILL_NAME, build, cleanReferencePage, frontMatter } from './build.mjs';

/** The entries of a zip written by build.mjs (no data descriptors, no zip64). */
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

test('SKILL.md front matter fits what claude.ai accepts', () => {
  const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8');
  const { name, description } = frontMatter(skill);
  assert.equal(name, SKILL_NAME);
  assert.ok(name.length <= 64, 'name is at most 64 characters');
  assert.ok(
    description && description.length <= 200,
    `description is ${description?.length} characters, at most 200`
  );
});

test('cleanReferencePage drops automation, test-server and source sections', () => {
  const page = [
    '# Page',
    '',
    '## How to reach it',
    '',
    '- Click **Combat**.',
    'Sources: `C:/FoundryTest/app/x.mjs`,',
    '`C:/FoundryTest/app/y.mjs`',
    '',
    '- Next bullet stays.',
    '',
    '## Driving it from automation',
    '',
    '`game.combat.nextTurn()`',
    '',
    '## Safety in the test world',
    '',
    'Use a throwaway actor.',
    '',
    '## Sources',
    '',
    '- `C:/FoundryTest/app/z.mjs`',
    '',
  ].join('\n');
  const out = cleanReferencePage(page);
  assert.match(out, /Click \*\*Combat\*\*/);
  assert.match(out, /Next bullet stays/);
  assert.doesNotMatch(out, /x\.mjs|y\.mjs|z\.mjs|nextTurn|throwaway|Driving it|Safety in/);
});

test('the build writes the folder and a zip with the skill folder at its root', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'gm-coach-'));
  try {
    const { zipFile, files } = build(out);
    assert.ok(existsSync(path.join(out, SKILL_NAME, 'SKILL.md')));
    const entries = readZip(readFileSync(zipFile));
    assert.equal(entries.size, files.size);
    for (const name of entries.keys()) assert.ok(name.startsWith(`${SKILL_NAME}/`), name);
    assert.equal(entries.get(`${SKILL_NAME}/SKILL.md`), files.get('SKILL.md'));
    for (const folder of ['references/foundry/', 'references/gm/', 'references/player/']) {
      assert.ok(
        [...files.keys()].some(n => n.startsWith(folder)),
        `has ${folder}`
      );
    }
    // The Foundry pages lose their automation sections.
    const sheets = files.get('references/foundry/dnd5e-actor-sheets.md');
    assert.ok(sheets && !/^## Driving it from automation/m.test(sheets));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('every Foundry page SKILL.md names exists', () => {
  const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8');
  const out = mkdtempSync(path.join(tmpdir(), 'gm-coach-'));
  try {
    const { files } = build(out);
    const named = [...skill.matchAll(/`(references\/foundry\/[^`]+\.md)`/g)].map(m => m[1]);
    assert.ok(named.length >= 10);
    for (const name of named) assert.ok(files.has(name), `${name} is in the skill`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
