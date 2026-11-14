import { describe, expect, it } from 'vitest';

import { applyScheme, followFrameScheme, parseSchemeMessage } from './scheme';

describe('parseSchemeMessage', () => {
  it('takes light and dark only', () => {
    expect(parseSchemeMessage({ type: 'fmb-live-scheme', scheme: 'light' })).toBe('light');
    expect(parseSchemeMessage({ type: 'fmb-live-scheme', scheme: 'dark' })).toBe('dark');
    expect(parseSchemeMessage({ type: 'fmb-live-scheme', scheme: 'red' })).toBeNull();
    expect(parseSchemeMessage({ type: 'other', scheme: 'light' })).toBeNull();
    expect(parseSchemeMessage(null)).toBeNull();
    expect(parseSchemeMessage('light')).toBeNull();
  });
});

describe('applyScheme', () => {
  it('sets data-scheme', () => {
    const el = { dataset: {} } as unknown as HTMLElement;
    applyScheme('light', el);
    expect(el.dataset.scheme).toBe('light');
  });
});

describe('followFrameScheme', () => {
  function fakeWindow(search: string): {
    win: Window;
    send: (e: object) => void;
    root: HTMLElement;
  } {
    const root = { dataset: {} } as unknown as HTMLElement;
    let handler: ((e: MessageEvent) => void) | null = null;
    const win = {
      location: { search },
      document: { documentElement: root },
      parent: {} as Window,
      addEventListener: (_: string, fn: (e: MessageEvent) => void): void => {
        handler = fn;
      },
      removeEventListener: (): void => {
        handler = null;
      },
    } as unknown as Window;
    const send = (e: object): void => handler?.(e as MessageEvent);
    return { win, send, root };
  }

  it('reads the address, then follows the parent only', () => {
    const { win, send, root } = fakeWindow('?strip=1&scheme=light');
    followFrameScheme(win);
    expect(root.dataset.scheme).toBe('light');
    send({ source: {}, data: { type: 'fmb-live-scheme', scheme: 'dark' } });
    expect(root.dataset.scheme).toBe('light');
    send({ source: win.parent, data: { type: 'fmb-live-scheme', scheme: 'dark' } });
    expect(root.dataset.scheme).toBe('dark');
  });

  it('ignores a message whose origin is not the parent origin the browser names', () => {
    const { win, send, root } = fakeWindow('?strip=1');
    (win.location as unknown as { ancestorOrigins: string[] }).ancestorOrigins = [
      'https://foundry.example',
    ];
    followFrameScheme(win);
    const data = { type: 'fmb-live-scheme', scheme: 'light' };
    send({ source: win.parent, origin: 'https://evil.example', data });
    expect(root.dataset.scheme).toBeUndefined();
    send({ source: win.parent, origin: 'https://foundry.example', data });
    expect(root.dataset.scheme).toBe('light');
  });

  it('leaves the page alone without a scheme', () => {
    const { win, root } = fakeWindow('?strip=1');
    followFrameScheme(win);
    expect(root.dataset.scheme).toBeUndefined();
  });
});
