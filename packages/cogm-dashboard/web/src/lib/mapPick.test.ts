import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIVE_PICK_MESSAGE,
  LIVE_READY_MESSAGE,
  currentMapPick,
  listenForMapPick,
  parsePickMessage,
  resetMapPick,
  setMapPick,
} from './mapPick';

afterEach(() => resetMapPick());

describe('parsePickMessage', () => {
  it('reads the token ids of a pick message', () => {
    expect(parsePickMessage({ type: LIVE_PICK_MESSAGE, tokenIds: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(parsePickMessage({ type: LIVE_PICK_MESSAGE, tokenIds: [] })).toEqual([]);
  });

  it('drops anything that is not a non-empty string id', () => {
    expect(parsePickMessage({ type: LIVE_PICK_MESSAGE, tokenIds: ['a', 3, '', null, {}] })).toEqual(
      ['a']
    );
  });

  it('ignores other messages', () => {
    expect(parsePickMessage(null)).toBeNull();
    expect(parsePickMessage('x')).toBeNull();
    expect(parsePickMessage({ type: 'other', tokenIds: ['a'] })).toBeNull();
    expect(parsePickMessage({ type: LIVE_PICK_MESSAGE, tokenIds: 'a' })).toBeNull();
  });

  it('caps the list', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `t${i}`);
    expect(parsePickMessage({ type: LIVE_PICK_MESSAGE, tokenIds: ids })).toHaveLength(200);
  });
});

describe('listenForMapPick', () => {
  function fakeWindow(): {
    win: Window;
    parent: object;
    fire: (source: unknown, data: unknown) => void;
  } {
    const handlers: Array<(e: MessageEvent) => void> = [];
    const parent = { postMessage: (): void => undefined };
    const win = {
      parent,
      addEventListener: (_: string, fn: (e: MessageEvent) => void) => handlers.push(fn),
      removeEventListener: (_: string, fn: (e: MessageEvent) => void) => {
        handlers.splice(handlers.indexOf(fn), 1);
      },
    } as unknown as Window;
    return {
      win,
      parent,
      fire: (source, data) => handlers.forEach(fn => fn({ source, data } as MessageEvent)),
    };
  }

  it('takes a pick from the parent frame only', () => {
    const { win, parent, fire } = fakeWindow();
    const stop = listenForMapPick(win);
    fire({}, { type: LIVE_PICK_MESSAGE, tokenIds: ['x'] });
    expect(currentMapPick()).toBeNull();
    fire(parent, { type: LIVE_PICK_MESSAGE, tokenIds: ['a'] });
    expect(currentMapPick()).toEqual(['a']);
    fire(parent, { type: 'other', tokenIds: ['b'] });
    expect(currentMapPick()).toEqual(['a']);
    stop();
    fire(parent, { type: LIVE_PICK_MESSAGE, tokenIds: ['c'] });
    expect(currentMapPick()).toEqual(['a']);
  });

  it('tells its parent it is listening', () => {
    const posted: unknown[] = [];
    const parent = {
      postMessage: (data: unknown): void => {
        posted.push(data);
      },
    };
    const win = { parent, addEventListener: (): void => undefined } as unknown as Window;
    listenForMapPick(win);
    expect(posted).toEqual([{ type: LIVE_READY_MESSAGE }]);
  });

  it('does nothing on a page that is not in a frame', () => {
    const handlers: Array<(e: MessageEvent) => void> = [];
    const win = {
      addEventListener: (_: string, fn: (e: MessageEvent) => void) => handlers.push(fn),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    (win as unknown as { parent: Window }).parent = win;
    listenForMapPick(win);
    handlers.forEach(fn =>
      fn({ source: win, data: { type: LIVE_PICK_MESSAGE, tokenIds: ['a'] } } as MessageEvent)
    );
    expect(currentMapPick()).toBeNull();
  });

  it('in its own window, takes a pick from the opener on its own origin and says it listens', () => {
    const handlers: Array<(e: MessageEvent) => void> = [];
    const posted: Array<[unknown, string]> = [];
    const opener = { postMessage: (d: unknown, o: string): void => void posted.push([d, o]) };
    const win = {
      opener,
      location: { origin: 'https://cogm.example.com' },
      addEventListener: (_: string, fn: (e: MessageEvent) => void) => handlers.push(fn),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    (win as unknown as { parent: Window }).parent = win;
    listenForMapPick(win);
    expect(posted).toEqual([[{ type: LIVE_READY_MESSAGE }, 'https://cogm.example.com']]);
    const send = (source: unknown, origin: string, ids: string[]): void =>
      handlers.forEach(fn =>
        fn({ source, origin, data: { type: LIVE_PICK_MESSAGE, tokenIds: ids } } as MessageEvent)
      );
    send({}, 'https://cogm.example.com', ['x']);
    send(opener, 'https://evil.example', ['y']);
    expect(currentMapPick()).toBeNull();
    send(opener, 'https://cogm.example.com', ['a']);
    expect(currentMapPick()).toEqual(['a']);
  });

  it('keeps the same list object when the ids did not change', () => {
    setMapPick(['a']);
    const first = currentMapPick();
    setMapPick(['a']);
    expect(currentMapPick()).toBe(first);
  });
});
