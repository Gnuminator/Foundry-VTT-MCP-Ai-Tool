import { describe, expect, it } from 'vitest';

import {
  TOOL_REF_KEY,
  checkToolRefs,
  freeText,
  looksLikeRefParam,
  stripToolRefs,
  toolRef,
} from './tool-refs.js';

describe('looksLikeRefParam', () => {
  it('flags names ending in id, uuid, name, identifier, target(s), packs or folder', () => {
    for (const name of [
      'tokenId',
      'tokenIds',
      'actorUuid',
      'itemUuids',
      'actorName',
      'names',
      'characterIdentifier',
      'targets',
      'rollTarget',
      'compendiumPacks',
      'folder',
      'job_id',
      'uuid',
    ]) {
      expect(looksLikeRefParam(name), name).toBe(true);
    }
  });

  it('leaves other parameters alone', () => {
    for (const name of ['query', 'limit', 'nameFilter', 'targetAC', 'x', 'grid_size', 'skipTo']) {
      expect(looksLikeRefParam(name), name).toBe(false);
    }
  });
});

describe('checkToolRefs', () => {
  const tool = (properties: Record<string, unknown>): { name: string; inputSchema: unknown } => ({
    name: 't',
    inputSchema: { type: 'object', properties },
  });

  it('accepts annotated and plain parameters', () => {
    expect(
      checkToolRefs(
        tool({
          sceneId: { type: 'string', ...toolRef('scene', 'id') },
          tokenIds: {
            type: 'array',
            items: { type: 'string' },
            ...toolRef('token', 'id', { parent: 'sceneId' }),
          },
          name: { type: 'string', ...freeText('the name of the new NPC') },
          limit: { type: 'integer' },
        })
      )
    ).toEqual([]);
  });

  it('reports unannotated reference-like parameters', () => {
    expect(checkToolRefs(tool({ tokenId: { type: 'string' } }))).toEqual([
      't.tokenId looks like a reference: add toolRef(...) or freeText(reason)',
    ]);
  });

  it('reports bad annotations', () => {
    const problems = checkToolRefs(
      tool({
        a: { type: 'string', [TOOL_REF_KEY]: { kind: 'nope', value: 'id' } },
        b: { type: 'string', [TOOL_REF_KEY]: { kind: 'token', value: 'label' } },
        c: { type: 'string', ...toolRef('token', 'id', { parent: 'missing' }) },
        d: { type: 'integer', ...toolRef('token', 'id') },
        e: { type: 'string', [TOOL_REF_KEY]: { kind: 'free' } },
        f: { type: 'string', [TOOL_REF_KEY]: { kind: 'actor', value: 'id', filter: { bad: 1 } } },
      })
    );
    expect(problems).toEqual([
      't.a: unknown kind "nope"',
      't.b: value must be id, uuid or name',
      't.c: parent "missing" is not another parameter',
      't.d: a picker needs a string or an array of strings',
      't.e: freeText needs a reason',
      't.f: unknown filter "bad"',
    ]);
  });
});

describe('stripToolRefs', () => {
  it('removes every annotation and leaves the rest untouched', () => {
    const tools = [
      {
        name: 't',
        description: 'd',
        inputSchema: {
          type: 'object',
          properties: {
            tokenId: { type: 'string', description: 'x', ...toolRef('token', 'id') },
            nested: { type: 'array', items: { type: 'string', ...freeText('r') } },
          },
        },
      },
    ];
    const stripped = stripToolRefs(tools);
    expect(JSON.stringify(stripped)).not.toContain(TOOL_REF_KEY);
    expect(stripped[0].inputSchema.properties.tokenId).toEqual({
      type: 'string',
      description: 'x',
    });
    expect(JSON.stringify(tools)).toContain(TOOL_REF_KEY);
  });
});
