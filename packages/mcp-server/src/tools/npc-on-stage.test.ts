import { describe, expect, it, vi, type Mock } from 'vitest';

import { NPC_ON_STAGE_EVENT, NpcOnStageTools } from './npc-on-stage.js';

interface Harness {
  tools: NpcOnStageTools;
  query: Mock;
  appendLines: Mock;
  error: Mock;
}

function setup(reply: unknown, appendFails = false): Harness {
  const query = vi.fn(async (): Promise<unknown> => reply);
  const appendLines = vi.fn(async (): Promise<void> => {
    if (appendFails) throw new Error('disk full');
  });
  const error = vi.fn();
  const logger = { child: (): { error: Mock } => ({ error }) };
  const tools = new NpcOnStageTools({
    foundryClient: { query } as never,
    worldIds: { currentOrLastKnown: async (): Promise<string> => 'w1' },
    store: { appendLines } as never,
    logger: logger as never,
    now: (): number => Date.UTC(2026, 10, 26, 12, 0, 0),
  });
  return { tools, query, appendLines, error };
}

describe('set-npc-on-stage', () => {
  it('sends the request to the bridge and logs who went on stage with the true name', async () => {
    const reply = {
      success: true,
      onStage: { actorId: 'a1', name: 'Hrafne', nameShown: false },
      previous: { actorId: 'a0' },
    };
    const { tools, query, appendLines } = setup(reply);
    const out = await tools.handleSetNpcOnStage({ actorId: 'a1' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.setNpcOnStage', { actorId: 'a1' });
    expect(out).toEqual({ success: true, onStage: reply.onStage });
    const [, folder, , lines] = appendLines.mock.calls[0] as unknown as [
      string,
      string,
      string,
      Record<string, unknown>[],
    ];
    expect(folder).toBe('sessions');
    expect(lines[0]).toMatchObject({
      eventType: NPC_ON_STAGE_EVENT,
      actorName: 'Hrafne',
      actorId: 'a1',
      details: { onStage: true, nameShown: false, previousActorId: 'a0' },
      visibility: { subject: 'npc', tokenVisible: false, playerName: null },
    });
  });

  it('logs an off-stage line when cleared', async () => {
    const { tools, appendLines } = setup({ success: true, onStage: null, previous: null });
    const out = await tools.handleSetNpcOnStage({ clear: true });
    expect(out.onStage).toBeNull();
    const lines = (appendLines.mock.calls[0] as unknown as [string, string, string, unknown[]])[3];
    expect(lines[0]).toMatchObject({ actorName: null, details: { onStage: false } });
  });

  it('writes no log line when Foundry refuses', async () => {
    const { tools, appendLines } = setup({ success: false, error: 'Actor not found' });
    await expect(tools.handleSetNpcOnStage({ actorName: 'Nobody' })).rejects.toThrow(
      'Actor not found'
    );
    expect(appendLines).not.toHaveBeenCalled();
  });

  it('needs an actor or clear', async () => {
    const { tools, query } = setup({});
    await expect(tools.handleSetNpcOnStage({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the TV change when the log cannot be written', async () => {
    const { tools, error } = setup(
      { success: true, onStage: { actorId: 'a1', name: 'X', nameShown: true }, previous: null },
      true
    );
    const out = await tools.handleSetNpcOnStage({ actorId: 'a1' });
    expect(out.onStage?.name).toBe('X');
    expect(error).toHaveBeenCalled();
  });
});
