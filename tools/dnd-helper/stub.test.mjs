// node --test tools/dnd-helper/stub.test.mjs
// The thin skill stubs (client-skills-thin): what claude.ai gets, and that it matches the server.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SKILL_NAME, PLAYER_SKILL_NAME, buildPlayerStub, buildStub } from './build.mjs';
import { buildStub as buildCoachStub, frontMatter } from '../gm-coach/build.mjs';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** SKILL_STUB_REVISION from the shared source (a plain number literal). */
const REVISION = Number(
  /export const SKILL_STUB_REVISION = (\d+);/.exec(read('../../shared/src/client-versions.ts'))?.[1]
);

const STUBS = [
  { file: '../gm-coach/stub/SKILL.md', tool: 'get-skill-guide', skill: 'gm-coach' },
  { file: './stub/SKILL.md', tool: 'get-skill-guide', skill: 'dnd-helper' },
  { file: './stub-player/SKILL.md', tool: 'get-player-skill-guide', skill: null },
];

for (const stub of STUBS) {
  test(`${stub.file} is a thin stub that fits claude.ai and passes the right revision`, () => {
    const text = read(stub.file);
    const { name, description } = frontMatter(text);
    assert.ok(name && name.length <= 64);
    assert.ok(description && description.length <= 200, `description ${description?.length}`);
    assert.ok(text.length < 3000, 'a stub stays small');
    assert.ok(text.includes(`\`${stub.tool}\``));
    if (stub.skill) assert.ok(text.includes(`\`${stub.skill}\``));
    const revisions = [...text.matchAll(/`stubRevision`: `(\d+)`/g)].map(m => Number(m[1]));
    assert.deepEqual(revisions, [REVISION], 'the stub says the current stub revision');
  });
}

test('the player stub never names a GM tool, the GM stubs never the player tool', () => {
  assert.doesNotMatch(read('./stub-player/SKILL.md'), /`get-skill-guide`|apply-planned-change/);
  assert.doesNotMatch(read('./stub/SKILL.md'), /get-player-skill-guide/);
  assert.doesNotMatch(read('../gm-coach/stub/SKILL.md'), /get-player-skill-guide/);
});

test('the built zips hold only the stub', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'stubs-'));
  try {
    for (const [fn, expected] of [
      [buildStub, SKILL_NAME],
      [buildPlayerStub, PLAYER_SKILL_NAME],
      [buildCoachStub, 'foundry-gm-coach'],
    ]) {
      const { files } = fn(out);
      assert.deepEqual([...files.keys()], ['SKILL.md'], expected);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
