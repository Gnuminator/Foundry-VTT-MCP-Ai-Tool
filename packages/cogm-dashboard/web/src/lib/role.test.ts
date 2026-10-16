import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRoleNotice, sendPlayersToPlayerPage, subscribeRoleNotice } from './role';

// auth.ts reads the page's location when it loads; there is no page here. auth.test.ts covers it.
const auth = vi.hoisted(() => ({ onlyPlayerToken: false }));
vi.mock('./auth', () => ({
  authHeaders: (): Record<string, string> => ({}),
  onlyPlayerToken: (): boolean => auth.onlyPlayerToken,
  playerPageUrl: (): string => '/player',
}));

/** /api/state answers with this status and body. */
function answer(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
  );
}

async function wentTo(): Promise<string | null> {
  let url: string | null = null;
  await sendPlayersToPlayerPage(to => {
    url = to;
  });
  return url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  auth.onlyPlayerToken = false;
});

describe('sendPlayersToPlayerPage', () => {
  it('sends a player to the player view', async () => {
    answer(200, { role: 'player' });
    expect(await wentTo()).toBe('/player');
  });

  it('keeps the GM without a notice, and drops an older one', async () => {
    answer(200, { role: 'player', unknownToken: true });
    await wentTo();
    expect(getRoleNotice()).not.toBeNull();
    answer(200, { role: 'gm' });
    expect(await wentTo()).toBeNull();
    expect(getRoleNotice()).toBeNull();
  });

  it('keeps a token the server does not know (a stale GM link) and says so', async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeRoleNotice(seen);
    answer(200, { role: 'player', unknownToken: true });
    expect(await wentTo()).toBeNull();
    expect(getRoleNotice()).toBe(
      "This browser's GM link is not accepted any more. Open the GM link again."
    );
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps an Access token the server could not verify and says so', async () => {
    answer(200, { role: 'player', accessUnverified: true });
    expect(await wentTo()).toBeNull();
    expect(getRoleNotice()).toBe(
      'The Cloudflare sign-in could not be checked just now. Reload the page.'
    );
  });

  it('sends on a turned-away visitor only when the player page has a token and this one none', async () => {
    answer(401, { error: 'Unauthorized' });
    expect(await wentTo()).toBeNull();
    auth.onlyPlayerToken = true;
    expect(await wentTo()).toBe('/player');
  });

  it('stays when the server fails or does not answer', async () => {
    answer(500, { error: 'boom' });
    expect(await wentTo()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
    expect(await wentTo()).toBeNull();
  });
});
