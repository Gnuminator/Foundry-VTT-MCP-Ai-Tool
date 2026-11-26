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
  'plan-actor-image':
    'needs a picture file in an allowed folder on the PC (FOUNDRY_AI_TOOL_IMAGE_ROOTS); checked by hand on server A (plan, apply, actor read back, file served, undo, a file outside the folder refused, a 3 MB picture), see the PR',
  'plan-handout-press':
    'ships off (feature handouts) and needs Edge or Chrome on the PC to render; checked by hand on server B (letter, notice and card planned in about 1 s each, applied hidden, queued, revealed, picture served, undo), see the PR',
  'plan-token-rings':
    'ships off (feature token-rings); bulk write on every actor of the world (I-093); checked by hand on the strahd-kit copy on server C (plan, apply 150, apply the 7 left, new tokens ringed, undo both, ring count back to 0), and for tokens placed on a scene on server C (scenes without placed refused, plan one named token with a missing scene and name reported, apply, ring on, undo, ring off), see the PRs',
  'plan-table-viewer':
    'creates a Foundry user; checked by hand on server A (plan, apply, join as Table, undo), see the PR',
  'plan-scene-restore':
    'needs a backup copy of the world on disk and Foundry app files (I-128); checked by hand on server A (break a scene, restore, undo), see the PR',
  'plan-pc-creation':
    'ships behind the "Character creation" switch (pc-creation-tool); checked by hand on server B (build a PC with a container, apply, undo), see the PR',
  'plan-renown-change':
    'needs a faction actor and the dnd5e "Renown Scores" setting, which the sweep world lacks (D-146); checked by hand on server B on dnd5e 6.1.1 (adjust create and update, set-member, undo, a bogus member refused), see the PR',
  'plan-campaign-merge':
    'ships behind the "campaign-merge" switch and writes the eight Campaign journals of the world (D-151); the sweep world should not grow them; checked by hand on a test server (setup, plan, apply, re-plan idempotent, additions and changes plans, undo), see the PR',
  'plan-character-diaries':
    'ships off (feature character-diary, I-183 route B); covered by unit tests with the real guarded-write service (plan, apply, undo, ownership map); the live check on a test server (apply, a second player cannot open the journal, undo) is still owed, see the PR',
  'draft-omens':
    'writes only the bridge vault omens list and never Foundry (I-181); the draft, approve, send and undo-free flow is covered by the omens store tests and checked by hand on a test server with a second Discord account, see the PR',
  'draft-player-text':
    'writes only the bridge vault draft tray and never Foundry (I-069); publishing is a dashboard control method, not a tool; covered by the drafts store tests and checked by hand on a test server (draft, edit, publish to chat, discard), see the PR',
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
