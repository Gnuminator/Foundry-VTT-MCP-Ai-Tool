import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  ACTOR_ALIASES,
  RENAMED_TOOLS,
  TOOL_ALIASES,
  actorToolNames,
  applyParamAliases,
} from './param-aliases.js';

describe('RENAMED_TOOLS', () => {
  it('drops every alias once the package version reaches its until release', () => {
    const { version } = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
    ) as { version: string };
    const [major = 0, minor = 0] = version.split('.').map(Number);
    for (const [old, { until }] of Object.entries(RENAMED_TOOLS)) {
      const [untilMajor = 0, untilMinor = 0] = until.split('.').map(Number);
      const expired = major > untilMajor || (major === untilMajor && minor >= untilMinor);
      expect(expired, `${old}: delete this RENAMED_TOOLS entry, it ended with ${until}`).toBe(
        false
      );
    }
  });
});

const actorTools = new Set(['get-character']);

describe('applyParamAliases', () => {
  it('lists exactly the six old actor names and the per-tool renames', () => {
    expect([...ACTOR_ALIASES]).toEqual([
      'identifier',
      'characterIdentifier',
      'actorIdentifier',
      'actorName',
      'targetPlayer',
      'character',
    ]);
    expect(TOOL_ALIASES).toEqual({
      'list-scenes': { include_active_only: 'activeOnly' },
      'switch-scene': { scene_identifier: 'scene', sceneId: 'scene' },
    });
  });

  it.each(ACTOR_ALIASES)('renames %s to actor on a tool that takes actor', old => {
    expect(applyParamAliases('get-character', { [old]: 'Ireena', x: 1 }, actorTools)).toEqual({
      actor: 'Ireena',
      x: 1,
    });
  });

  it('keeps actor when both are sent', () => {
    expect(
      applyParamAliases('get-character', { actor: 'New', identifier: 'Old' }, actorTools)
    ).toEqual({ actor: 'New' });
  });

  it('leaves tools without an actor parameter alone', () => {
    const input = { identifier: 'x' };
    expect(applyParamAliases('other-tool', input, actorTools)).toBe(input);
  });

  it('renames the scene parameters', () => {
    expect(applyParamAliases('switch-scene', { scene_identifier: 'Inn' }, actorTools)).toEqual({
      scene: 'Inn',
    });
    expect(applyParamAliases('switch-scene', { sceneId: 'abc' }, actorTools)).toEqual({
      scene: 'abc',
    });
    expect(applyParamAliases('list-scenes', { include_active_only: true }, actorTools)).toEqual({
      activeOnly: true,
    });
  });

  it('passes non-object input through', () => {
    expect(applyParamAliases('get-character', undefined, actorTools)).toBeUndefined();
    expect(applyParamAliases('get-character', null, actorTools)).toBeNull();
  });

  it('finds the tools whose schema has an actor property', () => {
    const names = actorToolNames([
      { name: 'a', inputSchema: { properties: { actor: {} } } },
      { name: 'b', inputSchema: { properties: { identifier: {} } } },
      { name: 'c', inputSchema: undefined },
    ]);
    expect([...names]).toEqual(['a']);
  });
});
