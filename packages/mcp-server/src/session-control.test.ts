/**
 * The dashboard's switch control methods: session_switches (D3) and feature_switches (I-064).
 */
import { describe, expect, it, vi } from 'vitest';

import { handleFeatureSwitches, handleSessionSwitches } from './session-control.js';

describe('handleSessionSwitches (control method session_switches)', () => {
  it('passes ready and end through and reads for anything else', async () => {
    const query = vi.fn().mockResolvedValue({ switches: [] });
    await handleSessionSwitches(query, { action: 'ready' });
    await handleSessionSwitches(query, { action: 'end' });
    await handleSessionSwitches(query, { action: 'everything-on' });
    await handleSessionSwitches(query, undefined);
    expect(query.mock.calls).toEqual([
      ['foundry-mcp-bridge.sessionSwitches', { action: 'ready' }],
      ['foundry-mcp-bridge.sessionSwitches', { action: 'end' }],
      ['foundry-mcp-bridge.sessionSwitches', { action: 'get' }],
      ['foundry-mcp-bridge.sessionSwitches', { action: 'get' }],
    ]);
  });
});

describe('handleFeatureSwitches (control method feature_switches)', () => {
  it("reduces the module's feature list to what the cards show", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: 'handouts',
        name: 'AI Tool: Handouts (writes)',
        hint: 'x',
        enabled: false,
        writesAllowed: true,
      },
      {
        id: 'live-play',
        name: 'AI Tool: Live play (writes)',
        hint: 'y',
        defaultEnabled: true,
        enabled: true,
        writesAllowed: true,
        autoApply: false,
      },
      { name: 'no id' },
      7,
    ]);
    expect(await handleFeatureSwitches(query)).toEqual({
      writesAllowed: true,
      features: [
        { id: 'handouts', name: 'AI Tool: Handouts (writes)', enabled: false },
        { id: 'live-play', name: 'AI Tool: Live play (writes)', enabled: true, autoApply: false },
      ],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.listGuardedFeatures');
  });

  it('reports Allow Write Operations off', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 'party', name: 'P', enabled: true, writesAllowed: false }]);
    expect((await handleFeatureSwitches(query)).writesAllowed).toBe(false);
  });

  it("throws the module's refusal", async () => {
    const query = vi.fn().mockResolvedValue({ error: 'Access denied', success: false });
    await expect(handleFeatureSwitches(query)).rejects.toThrow('Access denied');
  });
});
