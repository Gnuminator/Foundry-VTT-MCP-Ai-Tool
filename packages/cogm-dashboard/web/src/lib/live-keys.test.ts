import { describe, expect, it } from 'vitest';

import { isTypingTarget, liveKeyAction, type KeyLike } from './live-keys';

const press = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra,
});
const body = { tagName: 'BODY' } as unknown as EventTarget;
const field = (tagName: string): EventTarget => ({ tagName }) as unknown as EventTarget;

describe('liveKeyAction', () => {
  it('maps the six keys, either case', () => {
    expect(liveKeyAction(press('n'), body, false)).toBe('next');
    expect(liveKeyAction(press('U'), body, false)).toBe('undo');
    expect(liveKeyAction(press('d'), body, false)).toBe('damage');
    expect(liveKeyAction(press('r'), body, false)).toBe('roll');
    expect(liveKeyAction(press('h'), body, false)).toBe('handout');
    expect(liveKeyAction(press('?'), body, false)).toBe('help');
  });
  it('does nothing for other keys', () => {
    expect(liveKeyAction(press('x'), body, false)).toBeNull();
    expect(liveKeyAction(press('Enter'), body, false)).toBeNull();
  });
  it('does nothing while typing', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(liveKeyAction(press('n'), field(tag), false)).toBeNull();
    }
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(isTypingTarget(editable)).toBe(true);
  });
  it('leaves browser and Foundry shortcuts alone', () => {
    expect(liveKeyAction(press('r', { ctrlKey: true }), body, false)).toBeNull();
    expect(liveKeyAction(press('n', { altKey: true }), body, false)).toBeNull();
    expect(liveKeyAction(press('u', { metaKey: true }), body, false)).toBeNull();
  });
  it('ignores held keys and open dialogs', () => {
    expect(liveKeyAction(press('n', { repeat: true }), body, false)).toBeNull();
    expect(liveKeyAction(press('n'), body, true)).toBeNull();
  });
});
