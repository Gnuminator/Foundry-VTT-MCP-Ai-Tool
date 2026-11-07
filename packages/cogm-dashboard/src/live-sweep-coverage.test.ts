import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classifyTool } from './tool-policy.js';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/**
 * Tools of the tool sets (docs/reference/TOOL-SETS.md) the live sweep (scripts/live-write-sweep.mjs) does not run, each with
 * the reason. A new write tool gets a sweep step in the same PR, or an entry here.
 */
const RECORDED_SKIPS: Record<string, string> = {
  'plan-scene-mood':
    'ships off (feature scene-mood) and needs a playlist in the world (I-034, I-129); checked by hand on server A (save, apply, music switch, undo), see the PR',
  'plan-actor-image':
    'needs a picture file in an allowed folder on the PC (FOUNDRY_AI_TOOL_IMAGE_ROOTS); checked by hand on server A (plan, apply, actor read back, file served, undo, a file outside the folder refused, a 3 MB picture), see the PR',
  'plan-token-rings':
    'ships off (feature token-rings); bulk write on every actor of the world (I-093); checked by hand on the strahd-kit copy on server C (plan, apply 150, apply the 7 left, new tokens ringed, undo both, ring count back to 0), and for tokens placed on a scene on server C (scenes without placed refused, plan one named token with a missing scene and name reported, apply, ring on, undo, ring off), see the PRs',
  'plan-table-viewer':
    'creates a Foundry user; checked by hand on server A (plan, apply, join as Table, undo), see the PR',
  'plan-foundry-setup':
    'ships off behind the "Foundry setup" switch (D-135); checked by hand on a test server (hide a pack from players, change and restore a setting, undo each, a refused value outside the choices, a refused Assistant GM downgrade), see the PR',
  'plan-npc-turn':
    'ships off behind the "NPC turn assistant" switch (I-125); checked by hand on server A (small combat: read, plan a move, apply, undo), see the PR',
  'plan-paper-sync':
    'ships off behind the "Paper sync" switch (Paper nights A); checked by hand on a test server (plan, apply, undo, a refused value above the maximum, an item removal with its second confirm), see the PR',
  'plan-scene-restore':
    'needs a backup copy of the world on disk and Foundry app files (I-128); checked by hand on server A (break a scene, restore, undo), see the PR',
  'plan-pc-creation':
    'ships behind the "Character creation" switch (pc-creation-tool); checked by hand on server A (build a PC with a container, apply, undo), see the PR',
  'plan-room-setup':
    'ships off behind the "Room setup" switch (I-133); checked by hand on server A (teleport and spawn: plan, apply, walk a token through, undo), see the PR',
};

/**
 * Every tool name in the set bullets ("- **core:** `a`, `b`") of docs/reference/TOOL-SETS.md.
 * The mcp-server catalog test keeps that page equal to TOOL_SETS, which tool-sets.ts derives from
 * the tool modules, so the page is the readable source here (this package does not import the
 * mcp-server).
 */
export function toolSetNamesOf(doc: string): string[] {
  const names = new Set<string>();
  const text = doc.replace(/\r\n/g, '\n');
  const bullet = /^- \*\*(?:core|play|prep|build|admin|player):\*\*(?:[^\n]|\n(?!\n|- ))*/gm;
  for (const block of text.matchAll(bullet)) {
    for (const name of block[0].matchAll(/`([a-z][a-z0-9-]*)`/g)) names.add(name[1]);
  }
  return [...names];
}

function toolSetNames(): string[] {
  return toolSetNamesOf(read('../../../docs/reference/TOOL-SETS.md'));
}

describe('live sweep coverage (I-016)', () => {
  it('reads the names of the set bullets of the tool sets page', () => {
    const doc = [
      '- **core:** `alpha-one`, `beta-two`,',
      '  `gamma-three`',
      '- **play:** `delta-four`',
      '',
      'Other text with `not-a-tool`.',
    ].join('\n');
    expect(toolSetNamesOf(doc)).toEqual(['alpha-one', 'beta-two', 'gamma-three', 'delta-four']);
  });

  it('finds the tools of the tool sets page', () => {
    expect(toolSetNames().length).toBeGreaterThan(90);
  });

  it('runs every write tool and every guarded plan tool, or records why not', () => {
    const names = toolSetNames();
    expect(names.length).toBeGreaterThan(50);
    const sweep = read('../../../scripts/live-write-sweep.mjs');
    const missing = names
      // classifyTool calls plan-* tools reads (they only plan), but they are the guarded writes.
      .filter(name => classifyTool(name) !== 'read' || name.startsWith('plan-'))
      .filter(name => !sweep.includes(`'${name}'`) && !(name in RECORDED_SKIPS));
    expect(missing, `add a sweep step (or a recorded skip) for: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps no skip entry for a tool that no longer exists or that the sweep now runs', () => {
    const names = toolSetNames();
    const sweep = read('../../../scripts/live-write-sweep.mjs');
    for (const name of Object.keys(RECORDED_SKIPS)) {
      expect(names).toContain(name);
      expect(sweep.includes(`'${name}'`)).toBe(false);
    }
  });
});
