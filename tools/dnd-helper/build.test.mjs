// node --test tools/dnd-helper/build.test.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { frontMatter } from '../gm-coach/build.mjs';
import {
  PLAYER_SKILL_NAME,
  PLAYER_TOOLS,
  SKILL_NAME,
  build,
  buildPlayer,
  collectFiles,
} from './build.mjs';

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

test('the player guides are in, without dangling image links, and no page has an em dash', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-'));
  try {
    const { files } = build(out);
    const guide = files.get('references/player/make-a-character.md');
    assert.ok(guide && files.has('references/player/join.md'));
    assert.doesNotMatch(guide, /\]\(\.\.\/images\//);
    const emDash = String.fromCharCode(0x2014);
    for (const [name, text] of files) assert.ok(!text.includes(emDash), `${name} has an em dash`);
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

// ---- player edition ----

/**
 * The tools of each set, from the set bullets ("- **core:** `a`, `b`") of
 * docs/reference/TOOL-SETS.md. tool-sets.ts derives the lists from the tool modules, and the
 * mcp-server catalog test keeps that page equal to them, so the page is the readable source here.
 */
function toolSetLists() {
  const doc = readFileSync(
    new URL('../../docs/reference/TOOL-SETS.md', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const sets = new Map();
  for (const m of doc.matchAll(/^- \*\*([a-z]+):\*\*((?:[^\n]|\n(?!\n|- ))*)/gm)) {
    sets.set(
      m[1],
      [...m[2].matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map(n => n[1])
    );
  }
  return sets;
}

/** Every tool name of the GM sets (all sets but player). */
function gmToolNames() {
  const sets = toolSetLists();
  sets.delete('player');
  return new Set([...sets.values()].flat());
}

const OWN_PAGE = name => !name.startsWith('references/player/');

function withPlayerBuild(fn) {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-player-'));
  try {
    return fn(buildPlayer(out));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test('the player zip has the skill folder at its root and valid front matter', () => {
  withPlayerBuild(({ zipFile, files }) => {
    const entries = readZip(readFileSync(zipFile));
    assert.equal(entries.size, files.size);
    for (const name of entries.keys()) assert.ok(name.startsWith(`${PLAYER_SKILL_NAME}/`), name);
    const { name, description } = frontMatter(files.get('SKILL.md'));
    assert.equal(name, PLAYER_SKILL_NAME);
    assert.ok(description && description.length <= 200, `description is ${description?.length}`);
  });
});

test('the player zip names only player-set tools and no GM tool', () => {
  const gm = gmToolNames();
  assert.ok(gm.has('apply-planned-change'), 'the tool sets page was parsed');
  for (const t of PLAYER_TOOLS) gm.delete(t);
  withPlayerBuild(({ files }) => {
    const named = new Set();
    for (const [name, text] of files) {
      // Allowlist: every backticked kebab-case token, on every page, must be a player tool.
      for (const m of text.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
        named.add(m[1]);
        assert.ok(PLAYER_TOOLS.includes(m[1]), `${name} names ${m[1]}, not a player tool`);
      }
      // Denylist: no GM tool name anywhere in the text, backticked or not.
      for (const tool of gm) {
        assert.ok(!new RegExp(`(?<![a-z0-9-])${tool}(?![a-z0-9-])`).test(text), `${name}: ${tool}`);
      }
      assert.doesNotMatch(text, /\bcore set\b|search-rules|compendium-pack/i, name);
    }
    for (const t of PLAYER_TOOLS) assert.ok(named.has(t), `${t} is named somewhere`);
  });
});

test('the player zip has the same pages as the GM zip and stays advise-only', () => {
  withPlayerBuild(({ files }) => {
    assert.deepEqual([...files.keys()].sort(), [...collectFiles().keys()].sort());
    assert.match(files.get('SKILL.md'), /Advise only/);
    for (const [name, text] of files) {
      if (!OWN_PAGE(name)) continue;
      assert.doesNotMatch(text, /`(plan-[a-z-]+|apply-planned-change|undo-change)`/, name);
    }
  });
});

test('the player zip has no em dash and a labelled link to the Dungeon Mister guides', () => {
  withPlayerBuild(({ files }) => {
    const emDash = String.fromCharCode(0x2014);
    for (const [name, text] of files) assert.ok(!text.includes(emDash), `${name} has an em dash`);
    const skill = files.get('SKILL.md');
    const links = [...skill.matchAll(/<(https?:\/\/[^>\s]+)>/g)].map(m => m[1]);
    assert.deepEqual(links, ['https://dungeonmister.com/dnd-5e-2024/']);
    assert.match(skill, /opinion/i);
    for (const [name, text] of files) {
      if (name !== 'SKILL.md') assert.doesNotMatch(text, /dungeonmister/i, name);
    }
  });
});

test('the player zip holds no book text: our own pages only, no Foundry rules markup', () => {
  withPlayerBuild(({ files }) => {
    for (const [name, text] of files) {
      if (OWN_PAGE(name)) assert.ok(text.length < 12_000, `${name} is ${text.length} characters`);
      assert.doesNotMatch(text, /@UUID\[|\[\[\/(r|roll)\b|<section class="rules"/, name);
    }
  });
});

test('the skill is advise-only: no write tool is named as a step', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'dnd-helper-'));
  try {
    const { files } = build(out);
    for (const [name, text] of files) {
      // SKILL.md names the forbidden tools on purpose, in its ground rules.
      if (name === 'SKILL.md' || name.startsWith('references/player/')) continue;
      assert.doesNotMatch(
        text,
        /`(plan-actor-change|apply-planned-change|undo-change|plan-undo-changes|dnd5e-add-feature|dnd5e-add-features-from-compendium|create-actor-from-compendium)`/,
        `${name} names a write tool`
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('PLAYER_TOOLS is exactly the player set', () => {
  const names = toolSetLists().get('player');
  assert.ok(names, 'the player set was found on the tool sets page');
  assert.deepEqual([...PLAYER_TOOLS].sort(), [...names].sort());
});

test('every page the player SKILL.md names is in the zip', () => {
  withPlayerBuild(({ files }) => {
    const named = [...files.get('SKILL.md').matchAll(/`(references\/[A-Za-z0-9_./-]+\.md)`/g)].map(
      m => m[1]
    );
    assert.ok(named.length >= 7, 'the page table was parsed');
    for (const page of named) assert.ok(files.has(page), `${page} is named but not in the zip`);
  });
});

test('the player pages carry no server or module version provenance', () => {
  withPlayerBuild(({ files }) => {
    for (const [name, text] of files) {
      if (!OWN_PAGE(name)) continue;
      assert.doesNotMatch(text, /server C|Actor Studio \d|AI Tool mirror/i, name);
    }
  });
});
