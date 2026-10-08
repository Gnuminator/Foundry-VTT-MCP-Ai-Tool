// What the dashboard itself serves at /next/, with nothing faked: the cache headers of the built
// page and the GM check on a real route the page calls.
import { expect, test } from '@playwright/test';

import { GM_TOKEN } from './support';

test('index.html is checked on every load and the hashed assets are cached for good', async ({
  request,
}) => {
  const page = await request.get('/next/');
  expect(page.status()).toBe(200);
  expect(page.headers()['cache-control']).toBe('no-cache');

  const script = /src="(\/next\/assets\/[^"]+\.js)"/.exec(await page.text())?.[1];
  expect(script).toBeTruthy();
  const asset = await request.get(script ?? '');
  expect(asset.status()).toBe(200);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('the player links route wants the GM token', async ({ request }) => {
  // The test server sets no player token, so a request without the GM token is a player (403);
  // with a player token set it would be nobody (401). Either way the route refuses it.
  for (const headers of [{}, { 'x-cogm-token': 'not-the-token' }]) {
    const refused = await request.get('/api/player-links', { headers });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'gm-required' });
  }

  // The GM gets the list; with no bridge the player directory is empty, not an error.
  const gm = await request.get('/api/player-links', { headers: { 'x-cogm-token': GM_TOKEN } });
  expect(gm.status()).toBe(200);
  expect(await gm.json()).toEqual({ players: [] });
});
