import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';
import {
  SessionPostNotifier,
  createSessionFlagReader,
  sessionFlagFrom,
  sessionPostMessage,
} from './session-post.js';

const URL_ = 'https://play.example.test/player';
const END1 = '2026-10-28T22:00:00.000Z';
const END2 = '2026-11-04T22:00:00.000Z';

function make(ok = true) {
  const sent: string[] = [];
  const notifier = new SessionPostNotifier({
    pageUrl: URL_,
    send: (text): Promise<boolean> => {
      if (ok) sent.push(text);
      return Promise.resolve(ok);
    },
  });
  return { notifier, sent };
}

describe('sessionFlagFrom', () => {
  it('reads only the open flag and the end time', () => {
    expect(sessionFlagFrom({ session: { open: false, endedAt: END1 }, secret: 'x' })).toEqual({
      open: false,
      endedAt: END1,
    });
    expect(sessionFlagFrom({ session: { open: true, endedAt: null } })).toEqual({
      open: true,
      endedAt: null,
    });
  });

  it('is null for anything else', () => {
    expect(sessionFlagFrom(null)).toBeNull();
    expect(sessionFlagFrom({})).toBeNull();
    expect(sessionFlagFrom({ session: null })).toBeNull();
    expect(sessionFlagFrom({ session: { open: 'yes' } })).toBeNull();
  });
});

describe('SessionPostNotifier', () => {
  it('posts the link once when a seen-open session closes', async () => {
    const { notifier, sent } = make();
    expect(await notifier.check({ open: true, endedAt: null })).toBe(false);
    expect(await notifier.check({ open: true, endedAt: null })).toBe(false);
    expect(await notifier.check({ open: false, endedAt: END1 })).toBe(true);
    expect(await notifier.check({ open: false, endedAt: END1 })).toBe(false);
    expect(sent).toEqual([sessionPostMessage(URL_)]);
    expect(sent[0]).toContain(URL_);
  });

  it('says nothing on the first reading, even for a closed session', async () => {
    const { notifier, sent } = make();
    expect(await notifier.check({ open: false, endedAt: END1 })).toBe(false);
    expect(await notifier.check({ open: false, endedAt: END1 })).toBe(false);
    expect(sent).toEqual([]);
  });

  it('posts again for a later session', async () => {
    const { notifier, sent } = make();
    await notifier.check({ open: false, endedAt: END1 });
    await notifier.check({ open: true, endedAt: null });
    await notifier.check({ open: false, endedAt: END2 });
    expect(sent).toHaveLength(1);
  });

  it('ignores an unreadable state', async () => {
    const { notifier, sent } = make();
    await notifier.check({ open: true, endedAt: null });
    expect(await notifier.check(null)).toBe(false);
    expect(sent).toEqual([]);
  });

  it('tries again after a failed post', async () => {
    const failing = make(false);
    await failing.notifier.check({ open: true, endedAt: null });
    expect(await failing.notifier.check({ open: false, endedAt: END1 })).toBe(false);
    // Same notifier, now sending: swap the send through a fresh notifier in the same state.
    const sent: string[] = [];
    let ok = false;
    const n = new SessionPostNotifier({
      pageUrl: URL_,
      send: (t): Promise<boolean> => {
        if (ok) sent.push(t);
        return Promise.resolve(ok);
      },
    });
    await n.check({ open: true, endedAt: null });
    expect(await n.check({ open: false, endedAt: END1 })).toBe(false);
    ok = true;
    expect(await n.check({ open: false, endedAt: END1 })).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('createSessionFlagReader', () => {
  it('reads /api/player/state with the token and returns the flag', async () => {
    let seen: { url: string; headers: unknown } | null = null;
    const read = createSessionFlagReader({
      dashboardUrl: 'http://127.0.0.1:3100/',
      token: 't',
      fetch: ((url: string, init: { headers: unknown }) => {
        seen = { url, headers: init.headers };
        return Promise.resolve(
          new Response(JSON.stringify({ session: { open: false, endedAt: END1 } }))
        );
      }) as unknown as typeof fetch,
    });
    expect(await read()).toEqual({ open: false, endedAt: END1 });
    expect(seen).toEqual({
      url: 'http://127.0.0.1:3100/api/player/state',
      headers: { 'X-CoGM-Token': 't' },
    });
  });

  it('is null on an error status or a network failure', async () => {
    const bad = createSessionFlagReader({
      dashboardUrl: 'http://x',
      fetch: (() =>
        Promise.resolve(new Response('no', { status: 500 }))) as unknown as typeof fetch,
    });
    expect(await bad()).toBeNull();
    const down = createSessionFlagReader({
      dashboardUrl: 'http://x',
      fetch: (() => Promise.reject(new Error('refused'))) as unknown as typeof fetch,
    });
    expect(await down()).toBeNull();
  });
});

describe('config', () => {
  it('has the post off by default and reads the three settings when set', () => {
    const keys = [
      'DISCORD_SESSION_POST_CHANNEL_ID',
      'FOUNDRY_AI_DASHBOARD_URL',
      'FOUNDRY_AI_PLAYER_PAGE_URL',
      'FOUNDRY_AI_PLAYER_TOKEN',
    ];
    const saved = keys.map(k => process.env[k]);
    try {
      for (const k of keys) delete process.env[k];
      const off = loadConfig('does-not-exist.env', false);
      expect(off.sessionPostChannelId).toBeUndefined();
      process.env['DISCORD_SESSION_POST_CHANNEL_ID'] = '123';
      process.env['FOUNDRY_AI_PLAYER_PAGE_URL'] = URL_;
      const on = loadConfig('does-not-exist.env', false);
      expect(on.sessionPostChannelId).toBe('123');
      expect(on.playerPageUrl).toBe(URL_);
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });
});
