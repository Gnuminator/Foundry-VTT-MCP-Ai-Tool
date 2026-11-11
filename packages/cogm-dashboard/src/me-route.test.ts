/**
 * My character (I-096): a player's private link opens only their own sheets; the GM makes,
 * replaces and removes links; a wrong, old or missing key gets nothing.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, PLAYER_CSP, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-me';
const PLAYER_TOKEN = 'player-token-me';
const PLAYER = 'player0000000001';
const TAMSIN = 'tamsin0000000002';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

async function start(
  options: {
    shared?: boolean;
    failFor?: string;
    bare?: boolean;
    portrait?: 'on' | 'off' | 'unknown';
  } = {}
): Promise<{ base: string; asked: string[]; rolled: string[][]; portraits: string[][] }> {
  const asked: string[] = [];
  const rolled: string[][] = [];
  const portraits: string[][] = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(name: string): Promise<T> =>
      name === 'get-world-info'
        ? Promise.resolve({
            id: 'world-me',
            title: 'Test',
            system: { id: 'dnd5e' },
            playerUsers: [
              { id: PLAYER, name: 'Player', isGM: false },
              { id: TAMSIN, name: 'Tamsin', isGM: false },
            ],
          } as T)
        : Promise.reject(new Error('no tool')),
    playerRoll: (userId: string, buttonId: string): Promise<unknown> => {
      rolled.push([userId, buttonId]);
      return Promise.resolve(
        buttonId === 'wrongbutton00000'
          ? { success: false, error: 'There is no such roll request for you.' }
          : { success: true, message: 'Rolled.' }
      ).then(r =>
        buttonId === 'writesoff0000000'
          ? Promise.reject(
              new Error(
                'Player roll failed: Write operations are disabled in the module settings. In Foundry, open the Settings tab, Game Settings, Foundry AI Tool and turn on "Allow Write Operations".'
              )
            )
          : r
      );
    },
    playerPortrait: (
      userId: string,
      actorId: string,
      target: string,
      data: string
    ): Promise<unknown> => {
      portraits.push([userId, actorId, target, data]);
      if (actorId === 'notyours00000000') {
        return Promise.reject(
          Object.assign(new Error('That is not your character.'), { code: 'portrait' })
        );
      }
      if (actorId === 'boom000000000000') return Promise.reject(new Error('raw internal detail'));
      return Promise.resolve({ ok: true, path: 'assets/players/x/p.png', actorName: 'Brenna' });
    },
    featureSwitches: (): Promise<unknown> =>
      options.portrait === 'unknown'
        ? Promise.reject(new Error('no features'))
        : Promise.resolve({
            features: [{ id: 'player-portrait', enabled: options.portrait !== 'off' }],
            writesAllowed: true,
          }),
    characterSheet: (userId: string): Promise<unknown> => {
      asked.push(userId);
      if (userId === options.failFor) return Promise.reject(new Error('gone'));
      const own = { id: `own-${userId}`, name: `sheet of ${userId}` };
      return Promise.resolve({
        userId,
        userName: 'x',
        sheets: options.shared ? [own, { id: 'shared', name: 'Shared' }] : [{ name: own.name }],
        rollRequests: [
          { buttonId: 'abcdefghij012345', label: 'Stealth Skill Check (Private)', dc: 15 },
          { buttonId: 'bad id', label: 'x' },
        ],
      });
    },
  };
  if (options.bare) {
    delete (client as Partial<typeof client>).characterSheet;
    delete (client as Partial<typeof client>).playerRoll;
    delete (client as Partial<typeof client>).playerPortrait;
  }
  const testConfig: Config = {
    ...config,
    stateDir: undefined,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'me'),
    client,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The world is fetched in the background once Foundry is reachable: wait until the GM state has it.
  await vi.waitFor(
    async () => {
      const res = await fetch(`${base}/api/state`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
      const state = (await res.json()) as { world: { id: string } | null };
      expect(state.world?.id).toBe('world-me');
    },
    { timeout: 5000 }
  );
  return {
    base,
    asked,
    rolled,
    portraits,
  };
}

const gm = { 'X-CoGM-Token': GM_TOKEN };
const keyOf = (link: string): string => new URL(link, 'http://x').searchParams.get('k') ?? '';
const me = (base: string, key?: string): Promise<Response> =>
  fetch(`${base}/api/me`, { headers: key ? { 'X-CoGM-Me': key } : {} });

async function makeLink(base: string, userId: string): Promise<string> {
  const res = await fetch(`${base}/api/player-links/${userId}`, { method: 'POST', headers: gm });
  expect(res.status).toBe(200);
  return ((await res.json()) as { link: string }).link;
}

describe('/api/me and the player links', () => {
  it("a player link opens only that player's sheets", async () => {
    const { base, asked } = await start();
    const link = await makeLink(base, PLAYER);
    expect(link).toMatch(/^\/me\?k=[A-Za-z0-9_-]{24}$/);
    const res = await me(base, keyOf(link));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sheets: [{ name: `sheet of ${PLAYER}` }],
      theme: 'neutral',
    });
    expect(asked).toEqual([PLAYER]);
  });

  it('says whether the portrait switch is on, so the page can hide the upload control', async () => {
    for (const [portrait, expected] of [
      ['on', true],
      ['off', false],
      ['unknown', null],
    ] as const) {
      const { base } = await start({ portrait });
      const res = await me(base, keyOf(await makeLink(base, PLAYER)));
      expect(((await res.json()) as { portraitEnabled: unknown }).portraitEnabled).toBe(expected);
      dashboard?.close();
      await new Promise<void>(resolve => server!.close(() => resolve()));
      dashboard = null;
      server = null;
    }
  });

  it('lists the open roll requests as a button id and a label, nothing more', async () => {
    const { base } = await start();
    const res = await me(base, keyOf(await makeLink(base, PLAYER)));
    const body = (await res.json()) as { rollRequests: unknown };
    expect(body.rollRequests).toEqual([
      { buttonId: 'abcdefghij012345', label: 'Stealth Skill Check (Private)' },
    ]);
  });

  it('rolls for the player through their own key, as that player only', async () => {
    const { base, rolled } = await start();
    const key = keyOf(await makeLink(base, PLAYER));
    const post = (k: string | undefined, buttonId: unknown): Promise<Response> =>
      fetch(`${base}/api/me/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(k ? { 'X-CoGM-Me': k } : {}) },
        body: JSON.stringify({ buttonId }),
      });
    expect((await post(undefined, 'abcdefghij012345')).status).toBe(401);
    expect((await post('x'.repeat(24), 'abcdefghij012345')).status).toBe(401);
    expect((await post(key, 'not a button')).status).toBe(400);
    expect(rolled).toEqual([]);
    expect((await post(key, 'abcdefghij012345')).status).toBe(200);
    expect(rolled).toEqual([[PLAYER, 'abcdefghij012345']]);
    const refused = await post(key, 'wrongbutton00000');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/no such roll request/);
    const off = await post(key, 'writesoff0000000');
    expect(off.status).toBe(409);
    const offText = ((await off.json()) as { error: string }).error;
    expect(offText).toMatch(/switched off/);
    expect(offText).not.toMatch(/module settings/);
  });

  describe('uploading a portrait', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const ACTOR = 'actor00000000001';
    const upload = (
      base: string,
      key: string | undefined,
      body: Buffer,
      query = `actor=${ACTOR}&target=both`
    ): Promise<Response> =>
      fetch(`${base}/api/me/portrait?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(key ? { 'X-CoGM-Me': key } : {}),
        },
        body,
      });

    it('says so when the bridge cannot change pictures (501)', async () => {
      const { base } = await start({ bare: true });
      const res = await upload(base, keyOf(await makeLink(base, PLAYER)), PNG);
      expect(res.status).toBe(501);
      expect(((await res.json()) as { error: string }).error).toBe(
        'Changing your picture from this page is not available here.'
      );
    });

    it('sends the picture for the key owner, as that player only', async () => {
      const { base, portraits } = await start();
      const key = keyOf(await makeLink(base, PLAYER));
      expect((await upload(base, undefined, PNG)).status).toBe(401);
      expect((await upload(base, 'x'.repeat(24), PNG)).status).toBe(401);
      expect(portraits).toEqual([]);
      const res = await upload(base, key, PNG);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, actorName: 'Brenna' });
      expect(portraits).toEqual([[PLAYER, ACTOR, 'both', PNG.toString('base64')]]);
    });

    it('refuses what is not a PNG, JPG or WebP by its bytes, an empty body and a bad actor', async () => {
      const { base, portraits } = await start();
      const key = keyOf(await makeLink(base, PLAYER));
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      expect((await upload(base, key, html)).status).toBe(415);
      expect((await upload(base, key, Buffer.alloc(0))).status).toBe(400);
      expect((await upload(base, key, PNG, 'actor=../../etc&target=portrait')).status).toBe(400);
      expect(portraits).toEqual([]);
    });

    it('refuses a picture over 5 MB', async () => {
      const { base, portraits } = await start();
      const key = keyOf(await makeLink(base, PLAYER));
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      expect((await upload(base, key, big)).status).toBe(413);
      expect(portraits).toEqual([]);
    });

    it('shows a refusal the player can act on, and hides a raw failure', async () => {
      const { base } = await start();
      const key = keyOf(await makeLink(base, PLAYER));
      const refused = await upload(base, key, PNG, 'actor=notyours00000000&target=portrait');
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toBe(
        'That is not your character.'
      );
      const failed = await upload(base, key, PNG, 'actor=boom000000000000&target=portrait');
      expect(failed.status).toBe(502);
      expect(((await failed.json()) as { error: string }).error).not.toMatch(/raw internal/);
    });
  });

  it('no key, a wrong key or an old key gets nothing', async () => {
    const { base, asked } = await start();
    const old = keyOf(await makeLink(base, PLAYER));
    const fresh = keyOf(await makeLink(base, PLAYER));
    expect((await me(base)).status).toBe(401);
    expect((await me(base, 'x'.repeat(24))).status).toBe(401);
    expect((await me(base, old)).status).toBe(401);
    expect((await me(base, fresh)).status).toBe(200);
    expect(asked).toEqual([PLAYER]);
  });

  it('the key is never taken from the address', async () => {
    const { base, asked } = await start();
    const key = keyOf(await makeLink(base, PLAYER));
    expect((await fetch(`${base}/api/me?k=${key}`)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('the GM lists, makes and removes links; players cannot', async () => {
    const { base } = await start();
    await makeLink(base, TAMSIN);
    const list = (await (await fetch(`${base}/api/player-links`, { headers: gm })).json()) as {
      players: Array<{ userId: string; link: string | null }>;
    };
    expect(list.players.map(p => [p.userId, p.link !== null])).toEqual([
      [PLAYER, false],
      [TAMSIN, true],
    ]);
    const asPlayer = { 'X-CoGM-Token': PLAYER_TOKEN };
    expect((await fetch(`${base}/api/player-links`, { headers: asPlayer })).status).toBe(403);
    expect(
      (await fetch(`${base}/api/player-links/${PLAYER}`, { method: 'POST', headers: asPlayer }))
        .status
    ).toBe(403);
    // With a player token set, a caller with no token (or a wrong one) is nobody: 401.
    for (const headers of [{}, { 'X-CoGM-Token': 'not-a-token' }]) {
      const res = await fetch(`${base}/api/player-links`, { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: 'gm-required' });
      for (const method of ['POST', 'DELETE']) {
        expect(
          (await fetch(`${base}/api/player-links/${TAMSIN}`, { method, headers })).status
        ).toBe(401);
      }
    }
    const key = keyOf(list.players[1].link!);
    const del = await fetch(`${base}/api/player-links/${TAMSIN}`, {
      method: 'DELETE',
      headers: gm,
    });
    expect(await del.json()).toEqual({ removed: true });
    expect((await me(base, key)).status).toBe(401);
  });

  it('the GM gets every player character for the paper night print; nobody else does', async () => {
    const { base } = await start({ shared: true });
    const res = await fetch(`${base}/api/party-sheets`, { headers: gm });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sheets: Array<{ id: string; player: string }> };
    // The character both players own shows once, under the first owner (sorted by name).
    expect(body.sheets.map(s => [s.id, s.player])).toEqual([
      [`own-${PLAYER}`, 'Player'],
      ['shared', 'Player'],
      [`own-${TAMSIN}`, 'Tamsin'],
    ]);
    const asPlayer = { 'X-CoGM-Token': PLAYER_TOKEN };
    expect((await fetch(`${base}/api/party-sheets`, { headers: asPlayer })).status).toBe(403);
    expect((await fetch(`${base}/api/party-sheets`)).status).toBe(401);
    // A player's own link does not open it either.
    const key = keyOf(await makeLink(base, PLAYER));
    const withKey = await fetch(`${base}/api/party-sheets`, { headers: { 'X-CoGM-Me': key } });
    expect(withKey.status).toBe(401);
  });

  it('serves the party print page under the strict page CSP, with no inline script', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/party-print.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(PLAYER_CSP);
    const html = await res.text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/\son\w+\s*=/i);
  });

  it('says what a bridge without the helpers cannot do (501) and hides a read failure (502)', async () => {
    const bare = await start({ bare: true });
    const bareKey = keyOf(await makeLink(bare.base, PLAYER));
    const sheet = await me(bare.base, bareKey);
    expect(sheet.status).toBe(501);
    expect(((await sheet.json()) as { error: string }).error).toBe(
      'Your sheet is not available here. Ask your GM.'
    );
    const roll = await fetch(`${bare.base}/api/me/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CoGM-Me': bareKey },
      body: JSON.stringify({ buttonId: 'abcdefghij012345' }),
    });
    expect(roll.status).toBe(501);
    expect(((await roll.json()) as { error: string }).error).toBe(
      'Rolling from this page is not available. Roll in Foundry.'
    );
    const failing = await start({ failFor: PLAYER });
    const failed = await me(failing.base, keyOf(await makeLink(failing.base, PLAYER)));
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toBe(
      'Could not read your character. Wait a moment and try again.'
    );
  });

  it('a player whose sheet cannot be read is named, the others still print', async () => {
    const { base } = await start({ failFor: PLAYER });
    const res = await fetch(`${base}/api/party-sheets`, { headers: gm });
    expect(await res.json()).toMatchObject({
      sheets: [{ name: `sheet of ${TAMSIN}`, player: 'Tamsin' }],
      unreadable: ['Player'],
    });
  });

  it('refuses a link for someone who is not a player of the world', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/player-links/nobody0000000003`, {
      method: 'POST',
      headers: gm,
    });
    expect(res.status).toBe(400);
  });
});
