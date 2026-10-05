import { describe, expect, it } from 'vitest';

import { DESTRUCTIVE_TOOLS, classifyTool, toolArgs } from './tool-policy.js';

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
      'open-in-foundry',
      'get-prep-digest',
      'get-party',
      'plan-party-change',
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

  it('treats the handout tools as reads, the reveal copy included (it only plans)', () => {
    for (const name of [
      'plan-page-reveal',
      'list-revealed-pages',
      'get-player-handouts',
      'get-player-visibility',
      'check-secret-terms',
    ]) {
      expect(classifyTool(name)).toBe('read');
    }
    // The copy flag passes through untouched (only the guarded tools get body flags).
    const args = { pageUuid: 'p', action: 'reveal', copy: true };
    expect(toolArgs('plan-page-reveal', args, { confirm: true })).toBe(args);
  });

  it('treats apply-planned-change as a write and undo-change as destructive', () => {
    expect(classifyTool('apply-planned-change')).toBe('write');
    expect(classifyTool('undo-change')).toBe('destructive');
    expect(classifyTool('clear-module-errors')).toBe('destructive');
  });

  it('treats plan-token-change as a read: it only plans; the delete is confirmed when applied (F5 L2)', () => {
    expect(classifyTool('plan-token-change')).toBe('read');
    // The old direct token tools are gone, so the proxy no longer lists delete-tokens.
    expect(DESTRUCTIVE_TOOLS.has('delete-tokens')).toBe(false);
  });

  it('treats plan-ownership-change as a read and no longer lists remove-actor-ownership as destructive (F5 L3)', () => {
    expect(classifyTool('plan-ownership-change')).toBe('read');
    expect(DESTRUCTIVE_TOOLS.has('remove-actor-ownership')).toBe(false);
  });

  it('treats plan-scene-change as a read, play-playlist as a write, and the old delete tools are gone (I-112)', () => {
    expect(classifyTool('plan-scene-change')).toBe('read');
    expect(classifyTool('play-playlist')).toBe('write');
    expect(DESTRUCTIVE_TOOLS.has('delete-map-note')).toBe(false);
    expect(DESTRUCTIVE_TOOLS.has('delete-measured-template')).toBe(false);
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
    const args = { tokens: ['Wolf 1'], action: 'delete', confirm: true };
    expect(toolArgs('plan-token-change', args, { confirm: true })).toBe(args);
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
