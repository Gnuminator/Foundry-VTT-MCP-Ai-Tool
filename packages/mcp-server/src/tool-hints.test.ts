/**
 * MCP tool annotations (I-124): every tool has a title and read/write hints,
 * and no write is marked read-only. The write list below is a second key on
 * purpose: turning a write into a read means changing tool-hints.ts and this
 * list.
 */
import { stripToolRefs } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { stubToolRouterDeps } from './test-support/stub-tool-deps.js';
import { TOOL_HINTS, toolAnnotations } from './tool-hints.js';
import { collectToolDefinitions } from './tool-router.js';
import { filterToolsBySets, resolveToolSets } from './tool-sets.js';

const tools = collectToolDefinitions(stubToolRouterDeps());
const names = tools.map(t => t.name);

/** Every tool that changes something: Claude Desktop keeps asking before these. */
const WRITES = [
  'advance-combat-turn',
  'apply-planned-change',
  'clear-module-errors',
  'create-actor-from-compendium',
  'create-campaign-dashboard',
  'create-quest-journal',
  'dnd5e-add-feature',
  'dnd5e-add-features-from-compendium',
  'dnd5e-create-npc',
  'link-quest-to-npc',
  'manage-rest',
  'manage-world-items',
  'mark-play-session',
  'play-playlist',
  'request-ability-check',
  'request-attack-roll',
  'request-player-rolls',
  'roll-initiative-for-npcs',
  'roll-npc-check',
  'roll-saving-throws',
  'send-chat-message',
  'set-initiative',
  'switch-scene',
  'undo-change',
  'update-quest-journal',
  'use-item',
  'use-npc-activity',
];

/** Name prefixes that always mean a write. */
const WRITE_VERBS = [
  'advance-',
  'apply-',
  'clear-',
  'create-',
  'dnd5e-add-',
  'dnd5e-create-',
  'link-',
  'manage-',
  'mark-',
  'play-',
  'request-',
  'roll-',
  'send-',
  'set-',
  'switch-',
  'undo-',
  'update-',
  'use-',
];

/** Name prefixes a read-only tool may have (a plan only stages a change). */
const READ_VERBS = [
  'check-',
  'get-',
  'list-',
  'measure-',
  'open-in-',
  'plan-',
  'search-',
  'suggest-',
];

describe('tool hints (I-124)', () => {
  it('has exactly one entry per tool', () => {
    expect(Object.keys(TOOL_HINTS).sort()).toEqual([...names].sort());
    for (const tool of tools) expect(tool.annotations, tool.name).toBeDefined();
  });

  it('gives every tool a unique, non-empty title', () => {
    const titles = tools.map(t => t.annotations?.title ?? '');
    for (const [i, title] of titles.entries()) expect(title.trim(), names[i]).not.toBe('');
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('marks exactly the write list as not read-only', () => {
    const writes = tools.filter(t => t.annotations?.readOnlyHint === false).map(t => t.name);
    expect(writes.sort()).toEqual([...WRITES].sort());
  });

  it('never marks a tool named like a write as read-only', () => {
    for (const name of names) {
      if (WRITE_VERBS.some(verb => name.startsWith(verb))) {
        expect(toolAnnotations(name)?.readOnlyHint, name).toBe(false);
      }
    }
  });

  it('marks a tool read-only only when its name reads like a look-up or a plan', () => {
    for (const name of names) {
      if (toolAnnotations(name)?.readOnlyHint) {
        expect(
          READ_VERBS.some(verb => name.startsWith(verb)),
          name
        ).toBe(true);
      }
    }
  });

  it('sets destructiveHint on every write and only there', () => {
    for (const tool of tools) {
      const hints = tool.annotations;
      if (hints?.readOnlyHint) expect(hints.destructiveHint, tool.name).toBeUndefined();
      else expect(typeof hints?.destructiveHint, tool.name).toBe('boolean');
    }
  });

  it('marks applying, undoing, overwriting and spending as destructive', () => {
    for (const name of [
      'apply-planned-change',
      'undo-change',
      'update-quest-journal',
      'use-item',
      'set-initiative',
      'manage-rest',
    ]) {
      expect(toolAnnotations(name)?.destructiveHint, name).toBe(true);
    }
  });

  it('keeps the annotations in what an MCP client receives', () => {
    const served = stripToolRefs(filterToolsBySets(tools, resolveToolSets('core')));
    const get = served.find(t => t.name === 'get-world-info');
    expect(get?.annotations).toEqual({
      title: 'Get world info',
      readOnlyHint: true,
    });
    const apply = served.find(t => t.name === 'apply-planned-change');
    expect(apply?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('has no entry for an unknown name, even an Object.prototype one', () => {
    expect(toolAnnotations('nope')).toBeUndefined();
    expect(toolAnnotations('toString')).toBeUndefined();
  });
});
