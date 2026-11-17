import type { ClientVersionsView } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import { clientBanners, splitAtLink } from './client-notices';

const view = (seen: ClientVersionsView['seen']): ClientVersionsView => ({
  current: '1.5.0',
  downloads: { connectors: 'https://example.test/setup.exe', obsidian: null },
  seen,
});
const row = (
  piece: ClientVersionsView['seen'][number]['piece'],
  behind: boolean,
  version: string | null = '1.4.0'
): ClientVersionsView['seen'][number] => ({
  piece,
  who: 'GM',
  version,
  behind,
  lastSeen: '2026-11-14T10:00:00Z',
});

describe('clientBanners', () => {
  it('shows nothing without an answer or when all are current', () => {
    expect(clientBanners(null)).toEqual([]);
    expect(clientBanners(view([row('connectors', false)]))).toEqual([]);
  });

  it('shows one banner per outdated GM piece', () => {
    const out = clientBanners(view([row('obsidian', true), row('connectors', true)]));
    expect(out.map(b => b.piece)).toEqual(['connectors', 'obsidian']);
    expect(out[0].da).toContain('1.4.0');
    expect(out[0].en).toContain('https://example.test/setup.exe');
  });

  it('never banners a player extension', () => {
    expect(clientBanners(view([row('player-extension', true)]))).toEqual([]);
  });

  it('says ? for an unreported version and survives a malformed answer', () => {
    expect(clientBanners(view([row('connectors', true, null)]))[0].da).toContain('?');
    expect(clientBanners({ current: '1' } as unknown as ClientVersionsView)).toEqual([]);
  });
});

describe('splitAtLink', () => {
  it('splits the line around its link', () => {
    expect(splitAtLink('Get it: https://a.test/x', 'https://a.test/x')).toEqual([
      'Get it: ',
      'https://a.test/x',
    ]);
    expect(splitAtLink('No link here', null)).toEqual(['No link here', null]);
  });
});
