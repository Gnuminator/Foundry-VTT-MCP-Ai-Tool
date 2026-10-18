// The header's mark for the live stream itself: nothing while the stream is up or has been down
// only a moment, one pill for all the panels when it stays down, a different line when the browser
// gave up, and gone again as soon as the stream is back. The stream is faked in the browser.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes } from './support';

const pill = (page: Page): Locator => page.locator('#stream-state .status-pill');

const SETTINGS = 'event: settings\ndata: {"gmActionsEnabled":true}\n\n';
const body = (retry: number): string => `retry: ${retry}\n\n${SETTINGS}`;

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
});

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('says nothing at first, then one mark in the header once the stream stays down', async ({
  page,
}) => {
  // The stream answers and ends, and the browser waits a long time before it tries again.
  await page.route('**/api/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: body(600_000) })
  );
  await load(page);
  // A drop is not shown at once: a restart of the server reconnects within a few seconds.
  await expect(pill(page)).toHaveCount(0);

  await expect(pill(page)).toContainText('Connection lost, reconnecting…', { timeout: 10_000 });
  await expect(pill(page)).toHaveAttribute('title', /out of date/);
  // Once, in the header, for every panel: it is in the status region of the header controls and
  // no panel carries a second one.
  await expect(page.locator('header .controls #stream-state')).toHaveAttribute('role', 'status');
  await expect(page.locator('.status-pill')).toHaveCount(1);
  await expect(page.locator('.pane .status-pill, [data-panel-state] .status-pill')).toHaveCount(0);
});

test('goes away as soon as the stream is back', async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => (release = resolve));
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    if (requests > 1) await gate;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: body(requests > 1 ? 600_000 : 100),
    });
  });
  await load(page);
  await expect(pill(page)).toContainText('Connection lost, reconnecting…', { timeout: 10_000 });

  release();
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator('#stream-state')).toHaveText('');
});

test('a quick reconnect is never shown', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    // The first connection ends, the second answers right away (and ends too, with a long wait).
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: body(requests > 1 ? 600_000 : 100),
    });
  });
  await load(page);
  await expect.poll(() => requests).toBeGreaterThan(1);
  // Well inside the grace (the pill needs 5 s of the stream being down).
  await page.waitForTimeout(500);
  await expect(pill(page)).toHaveCount(0);
});

test('says to reload when the browser gave up on the stream', async ({ page }) => {
  // A refused stream (a link that is no longer valid) is not retried by the browser; the page
  // makes new connections (2, 4 s apart) and says so once the third has failed too.
  let requests = 0;
  await page.route('**/api/stream**', route => {
    requests += 1;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"no"}',
    });
  });
  await load(page);
  await expect(pill(page)).toContainText('Connection closed: reload the page', { timeout: 15_000 });
  await expect(pill(page)).toHaveAttribute('data-stream', 'closed');
  expect(requests).toBeGreaterThanOrEqual(3);
});

test('comes back by itself after the stream was refused once (a 502 while the server restarts)', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/stream**', route => {
    requests += 1;
    if (requests === 1) {
      return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad gateway' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: body(600_000),
    });
  });
  await load(page);
  // The second connection is made after about 2 s and gets through; the header never complains.
  await expect.poll(() => requests, { timeout: 8000 }).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  await expect(pill(page)).toHaveCount(0);
});
