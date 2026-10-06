/**
 * Tests for the helpers the Handouts and Tarokka windows share: the field listener
 * (once per content element) and the redraw that keeps the scroll and the focused field.
 */
import { describe, expect, it, vi } from 'vitest';
import { bindFields, replaceKeepingFocus, type ContentLike } from './window-fields.js';

function fakeContent(): ContentLike & { listeners: Record<string, Array<(e: unknown) => void>> } {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    innerHTML: '',
    scrollTop: 0,
    listeners,
    addEventListener(type: string, listener: (event: Event) => void): void {
      (listeners[type] ??= []).push(listener as (e: unknown) => void);
    },
  };
}

function fire(content: ReturnType<typeof fakeContent>, type: string, target: unknown): void {
  for (const listener of content.listeners[type] ?? []) listener({ target });
}

describe('bindFields', () => {
  it('forwards input and change events of data-field inputs, with the position', () => {
    const content = fakeContent();
    const set = vi.fn();
    bindFields(content, set);
    fire(content, 'input', { dataset: { field: 'revealText', position: 'a' }, value: 'hi' });
    fire(content, 'change', {
      dataset: { field: 'showCards' },
      type: 'checkbox',
      checked: true,
    });
    expect(set).toHaveBeenNthCalledWith(1, 'revealText', 'a', 'hi');
    expect(set).toHaveBeenNthCalledWith(2, 'showCards', undefined, true);
  });

  it('ignores events from other elements', () => {
    const content = fakeContent();
    const set = vi.fn();
    bindFields(content, set);
    fire(content, 'change', { dataset: {} });
    fire(content, 'change', null);
    expect(set).not.toHaveBeenCalled();
  });

  it('binds once per content element, and not at all without addEventListener', () => {
    const content = fakeContent();
    bindFields(content, vi.fn());
    bindFields(content, vi.fn());
    expect(content.listeners.input).toHaveLength(1);
    expect(() => bindFields({ innerHTML: '', scrollTop: 0 }, vi.fn())).not.toThrow();
  });
});

describe('replaceKeepingFocus', () => {
  it('replaces the HTML and keeps the scroll position', () => {
    const content = { innerHTML: 'old', scrollTop: 40 };
    replaceKeepingFocus(content, 'new');
    expect(content).toMatchObject({ innerHTML: 'new', scrollTop: 40 });
  });

  it('puts the focus and the caret back on the field that had them', () => {
    const next = { focus: vi.fn(), setSelectionRange: vi.fn() };
    const active = {
      dataset: { field: 'revealText', position: 'a' },
      selectionStart: 3,
      selectionEnd: 5,
    };
    const querySelector = vi.fn(() => next);
    const content = {
      innerHTML: 'old',
      scrollTop: 0,
      ownerDocument: { activeElement: active },
      contains: (): boolean => true,
      querySelector,
    };
    replaceKeepingFocus(content, 'new');
    expect(querySelector).toHaveBeenCalledWith('[data-field="revealText"][data-position="a"]');
    expect(next.focus).toHaveBeenCalled();
    expect(next.setSelectionRange).toHaveBeenCalledWith(3, 5);
  });

  it('leaves the focus alone when it was outside the content or on a field-less element', () => {
    const querySelector = vi.fn();
    replaceKeepingFocus(
      {
        innerHTML: '',
        scrollTop: 0,
        ownerDocument: { activeElement: { dataset: { field: 'x' } } },
        contains: () => false,
        querySelector,
      },
      'new'
    );
    replaceKeepingFocus(
      {
        innerHTML: '',
        scrollTop: 0,
        ownerDocument: { activeElement: { dataset: {} } },
        contains: () => true,
        querySelector,
      },
      'new'
    );
    expect(querySelector).not.toHaveBeenCalled();
  });

  it('survives a field without a caret', () => {
    const next = {
      focus: vi.fn(),
      setSelectionRange: (): void => {
        throw new Error('no caret on a checkbox');
      },
    };
    const content = {
      innerHTML: '',
      scrollTop: 0,
      ownerDocument: { activeElement: { dataset: { field: 'showCards' } } },
      contains: (): boolean => true,
      querySelector: (): typeof next => next,
    };
    expect(() => replaceKeepingFocus(content, 'new')).not.toThrow();
    expect(next.focus).toHaveBeenCalled();
  });
});
