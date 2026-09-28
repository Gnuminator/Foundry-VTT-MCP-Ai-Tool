import { describe, expect, it } from 'vitest';

import { classifyTool, toolArgs } from './tool-policy.js';

describe('classifyTool', () => {
  it('treats read prefixes (incl. plan- and suggest-) and open-in-foundry as reads', () => {
    for (const name of [
      'get-character',
      'list-recent-changes',
      'search-compendium',
      'measure-distance',
      'plan-tarokka-reveal',
      'suggest-strahd-reaction',
      'suggest-balanced-encounter',
      'get-planned-change',
      'check-map-status',
      'open-in-foundry',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
  });

  it('treats the Tarokka tools as reads (they only plan; apply-planned-change writes)', () => {
    for (const name of [
      'get-tarokka-reading',
      'plan-tarokka-import',
      'plan-tarokka-links',
      'plan-tarokka-reveal',
      'suggest-tarokka-links',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
  });

  it('treats apply-planned-change as a write and undo-change as destructive', () => {
    expect(classifyTool('apply-planned-change')).toBe('write');
    expect(classifyTool('move-token')).toBe('write');
    expect(classifyTool('undo-change')).toBe('destructive');
    expect(classifyTool('delete-tokens')).toBe('destructive');
  });

  it('does not treat prefix look-alikes as reads', () => {
    expect(classifyTool('planet-strike')).toBe('write');
    expect(classifyTool('getaway')).toBe('write');
  });

  it('treats mark-play-session as a read (it only appends to the bridge session log)', () => {
    expect(classifyTool('mark-play-session')).toBe('read');
  });

  it('treats get-play-session as a read via the get- prefix', () => {
    expect(classifyTool('get-play-session')).toBe('read');
  });
});

describe('toolArgs', () => {
  it('passes args through unchanged for ordinary tools', () => {
    const args = { tokenId: 't', confirm: true };
    expect(toolArgs('move-token', args, { confirm: true })).toBe(args);
  });

  it('sets the guarded tools confirm flags only from the body', () => {
    expect(
      toolArgs('apply-planned-change', { planId: 'p' }, { confirm: true, confirmDestructive: true })
    ).toEqual({ planId: 'p', confirm: true, confirmDestructive: true });
    expect(toolArgs('apply-planned-change', { planId: 'p' }, { confirm: true })).toEqual({
      planId: 'p',
      confirm: true,
      confirmDestructive: false,
    });
    expect(
      toolArgs('undo-change', { changeId: 'c' }, { confirm: true, confirmDestructive: true })
    ).toEqual({ changeId: 'c', confirm: true, confirmDestructive: true });
  });

  it('ignores confirm flags smuggled into args', () => {
    expect(
      toolArgs(
        'apply-planned-change',
        { planId: 'p', confirm: true, confirmDestructive: true },
        { confirm: 'yes' }
      )
    ).toEqual({ planId: 'p', confirm: false, confirmDestructive: false });
  });
});
