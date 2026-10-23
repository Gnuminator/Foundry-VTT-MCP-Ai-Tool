import { describe, expect, it } from 'vitest';

import { collectArgs, paramsOf, startDraft, type ToolInfo } from './toolForm';

const rollTool: ToolInfo = {
  name: 'request-player-rolls',
  description: 'Ask a player for a roll',
  mutates: 'write',
  inputSchema: {
    properties: {
      rollTarget: { type: 'string' },
      isPublic: { type: 'boolean' },
      userConfirmedVisibility: { type: 'boolean' },
    },
    required: ['rollTarget', 'isPublic', 'userConfirmedVisibility'],
  },
};

describe('the roll tools’ visibility field', () => {
  it('is not on the form: the Public tick answers it', () => {
    const { props, required } = paramsOf(rollTool);
    expect(Object.keys(props)).toEqual(['rollTarget', 'isPublic']);
    expect(required).toEqual(['rollTarget', 'isPublic']);
  });

  it('is sent as true with a public or a private pick', () => {
    for (const isPublic of [true, false]) {
      const draft = { ...startDraft(rollTool), rollTarget: 'wis', isPublic };
      expect(collectArgs(rollTool, draft)).toEqual({
        args: { rollTarget: 'wis', isPublic, userConfirmedVisibility: true },
      });
    }
  });

  it('is left alone on a tool without a public tick', () => {
    const other: ToolInfo = {
      ...rollTool,
      inputSchema: { properties: { userConfirmedVisibility: { type: 'boolean' } } },
    };
    expect(Object.keys(paramsOf(other).props)).toEqual(['userConfirmedVisibility']);
  });
});
