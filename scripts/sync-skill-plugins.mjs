#!/usr/bin/env node
/**
 * Sync the thin skill stubs into the plugin marketplace repo (client-skills-thin), so the plugins
 * and the release zips come from the same stub sources and cannot drift.
 *
 *   node scripts/sync-skill-plugins.mjs <marketplace-repo-dir>   write the plugins and marketplace.json
 *   node scripts/sync-skill-plugins.mjs <dir> --check            exit 1 if <dir> differs, write nothing
 *
 * Only stub SKILL.md files go in, plus the GM coach's two offline pages from docs/gm (no book or campaign text, D-065): the changing content comes
 * from the table's server through get-skill-guide.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFLINE_PAGES } from '../tools/gm-coach/build.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Plugins shipped from the stubs. `skill` is the skill folder name (the stub's `name:`). */
export const PLUGINS = [
  {
    name: 'foundry-gm-coach',
    skill: 'foundry-gm-coach',
    stub: 'tools/gm-coach/stub/SKILL.md',
    description: 'Coach for a GM running D&D 5e on Foundry VTT 14 with Foundry AI Tool.',
  },
  {
    name: 'foundry-dnd-helper',
    skill: 'foundry-dnd-helper',
    stub: 'tools/dnd-helper/stub/SKILL.md',
    description:
      'D&D 5e (2024) helper at a Foundry VTT table: builds characters and answers rules questions from the books in Foundry (core connector, for the GM side; players use foundry-player-helper).',
  },
  {
    name: 'foundry-player-helper',
    skill: 'foundry-dnd-helper-player',
    stub: 'tools/dnd-helper/stub-player/SKILL.md',
    description: 'D&D 5e helper for a player at a Foundry VTT table (player connector).',
  },
];

const json = value => JSON.stringify(value, null, 2) + '\n';

/** The files of the marketplace repo that this script owns: path -> text. */
export function plan() {
  const files = new Map();
  files.set(
    '.claude-plugin/marketplace.json',
    json({
      name: 'foundry-ai-tool-plugins',
      owner: { name: 'Gnuminator' },
      plugins: PLUGINS.map(p => ({
        name: p.name,
        source: `./plugins/${p.name}`,
        description: p.description,
      })),
    })
  );
  for (const p of PLUGINS) {
    files.set(
      `plugins/${p.name}/.claude-plugin/plugin.json`,
      json({ name: p.name, description: p.description, author: { name: 'Gnuminator' } })
    );
    files.set(
      `plugins/${p.name}/skills/${p.skill}/SKILL.md`,
      readFileSync(path.join(repo, p.stub), 'utf8')
    );
    // The GM coach also carries the offline pages, for a night when the server is down.
    if (p.skill === 'foundry-gm-coach') {
      for (const [to, from] of Object.entries(OFFLINE_PAGES)) {
        files.set(
          `plugins/${p.name}/skills/${p.skill}/${to}`,
          readFileSync(path.join(repo, from), 'utf8')
        );
      }
    }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || dir.startsWith('--')) {
    console.error('usage: node scripts/sync-skill-plugins.mjs <marketplace-repo-dir> [--check]');
    process.exit(2);
  }
  const check = process.argv.includes('--check');
  let differs = 0;
  for (const [rel, text] of plan()) {
    const file = path.join(dir, rel);
    const same = existsSync(file) && readFileSync(file, 'utf8') === text;
    if (same) continue;
    differs++;
    console.log(`${check ? 'differs' : 'wrote'}: ${rel}`);
    if (!check) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
  }
  if (check && differs) process.exit(1);
}
