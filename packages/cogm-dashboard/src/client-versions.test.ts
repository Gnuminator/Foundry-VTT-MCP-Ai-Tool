import { CLIENT_NOTICE_INTERVAL_MS, TOOL_VERSION } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { ClientRegistry, parseWrapperStatus } from './client-versions.js';

describe('ClientRegistry', () => {
  it('keeps the last seen per piece and person and flags older ones', () => {
    const r = new ClientRegistry('1.2.0');
    r.record('player-extension', 'Alice', '1.0.0', 1000);
    r.record('player-extension', 'Alice', '1.1.0', 2000);
    r.record('player-extension', 'Bob', '1.2.0', 3000);
    r.record('obsidian', 'GM', null, 4000);
    const list = r.list();
    expect(list).toHaveLength(3);
    expect(list.find(c => c.who === 'Alice')).toMatchObject({ version: '1.1.0', behind: true });
    expect(list.find(c => c.who === 'Bob')?.behind).toBe(false);
    expect(list.find(c => c.piece === 'obsidian')).toMatchObject({ version: null, behind: false });
    expect(r.get('player-extension', 'Alice')?.lastSeen).toBe(new Date(2000).toISOString());
  });

  it('keys by the stable id and shows the label', () => {
    const r = new ClientRegistry('1.2.0');
    r.record('player-extension', 'user-1', '1.0.0', 1000, 'Alice');
    r.record('player-extension', 'user-1', '1.1.0', 2000, 'Alice B');
    r.record('player-extension', 'user-2', '1.2.0', 3000, 'Alice');
    expect(r.list()).toHaveLength(2);
    expect(r.get('player-extension', 'user-1')).toMatchObject({ who: 'Alice B', version: '1.1.0' });
    expect(r.get('player-extension', 'Alice')).toBeNull();
  });

  it('notifies at most once per key per interval', () => {
    const r = new ClientRegistry();
    expect(r.shouldNotify('a', 0)).toBe(true);
    expect(r.shouldNotify('a', CLIENT_NOTICE_INTERVAL_MS - 1)).toBe(false);
    expect(r.shouldNotify('b', 5)).toBe(true);
    expect(r.shouldNotify('a', CLIENT_NOTICE_INTERVAL_MS)).toBe(true);
  });

  it('caps its size', () => {
    const r = new ClientRegistry(TOOL_VERSION, 5);
    for (let i = 0; i < 50; i += 1) {
      r.record('player-extension', `p${i}`, '0.0.1', i);
      r.shouldNotify(`k${i}`, i);
    }
    expect(r.list()).toHaveLength(5);
    expect(r.list().map(c => c.who)).toContain('p49');
  });
});

describe('parseWrapperStatus', () => {
  it('reads wrappers defensively', () => {
    expect(parseWrapperStatus(null)).toBeNull();
    expect(parseWrapperStatus({})).toBeNull();
    expect(
      parseWrapperStatus({
        wrappers: [{ version: '1.2.3', build: 'abc', sets: 'play' }, 7, { version: 'junk' }],
      })
    ).toEqual({
      wrappers: [
        { version: '1.2.3', build: 'abc', sets: 'play' },
        { version: null, build: null, sets: '' },
      ],
    });
  });
});
