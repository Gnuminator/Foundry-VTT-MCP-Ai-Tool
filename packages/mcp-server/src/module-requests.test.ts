/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/explicit-function-return-type -- fakes that mimic async calls */
import { describe, expect, it, vi } from 'vitest';
import {
  AI_CHANGES_UPDATED_QUERY,
  createAiChangesAnnouncer,
  createModuleRequestHandler,
  requesterLabel,
} from './module-requests.js';

const danni = { userId: 'u1', userName: 'Danni' };

function makeHandler() {
  const list = vi.fn(async () => ({ changes: [] }));
  const apply = vi.fn(async () => ({ applied: true }));
  const handleUndoChange = vi.fn(async () => ({ mode: 'undo' }));
  const handler = createModuleRequestHandler({
    toolRouter: { 'list-recent-changes': list, 'apply-planned-change': apply },
    guardedChangeTools: { handleUndoChange } as never,
  });
  return { handler, list, apply, handleUndoChange };
}

describe('createModuleRequestHandler', () => {
  it('routes a read through the tool router', async () => {
    const { handler, list } = makeHandler();
    await expect(handler('list-recent-changes', { limit: 5 }, danni)).resolves.toEqual({
      changes: [],
    });
    expect(list).toHaveBeenCalledWith({ limit: 5 });
  });

  it('runs an undo with the name of the GM who asked, so the audit entry records it', async () => {
    const { handler, handleUndoChange } = makeHandler();
    await handler('undo-change', { changeId: 'c1', confirm: true }, danni);
    expect(handleUndoChange).toHaveBeenCalledWith({ changeId: 'c1', confirm: true }, 'Danni');
  });

  it('refuses a tool that is not on the module-request list, even when the router has it', async () => {
    const { handler, apply } = makeHandler();
    await expect(handler('apply-planned-change', { planId: 'p' }, danni)).rejects.toThrow(
      /not allowed for module requests/
    );
    await expect(handler('toString', {}, danni)).rejects.toThrow(/not allowed/);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('requesterLabel', () => {
  it('prefers the name and falls back to the id', () => {
    expect(requesterLabel(danni)).toBe('Danni');
    expect(requesterLabel({ userId: 'u2', userName: '' })).toBe('u2');
  });
});

describe('createAiChangesAnnouncer', () => {
  it('asks the module to announce, without waiting for it', () => {
    let finish: (value: unknown) => void = () => undefined;
    const query = vi.fn(() => new Promise(resolve => (finish = resolve)));
    const logger = { debug: vi.fn() };
    const result = createAiChangesAnnouncer({ query }, logger)('world', 'chg-1');
    expect(result).toBeUndefined(); // the recorded hook never waits for the module
    expect(query).toHaveBeenCalledWith(
      AI_CHANGES_UPDATED_QUERY,
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    finish({ announced: true });
  });

  it('logs and swallows a failure (Foundry disconnected, or an older module)', async () => {
    const query = vi.fn(async () => {
      throw new Error('Foundry VTT module not connected');
    });
    const logger = { debug: vi.fn() };
    expect(() => createAiChangesAnnouncer({ query }, logger)('world', 'chg-1')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.debug).toHaveBeenCalledWith(
      'Could not announce the recorded change to the module',
      { error: 'Foundry VTT module not connected' }
    );
  });
});
