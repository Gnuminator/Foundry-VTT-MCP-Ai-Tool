// The play session marker in the header: the status line, Start / End session through
// mark-play-session (a log-only tool: no GM Actions, no confirm) and the refresh after it.
import { expect, test, type Page } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeStream,
  fakeTools,
  ok,
  toast,
  type ToolCall,
} from './support';

/** A bridge whose play session starts closed; mark-play-session flips it, like the real one. */
async function fakeBridge(
  page: Page,
  { markFails = false, readFailsAfterMark = false } = {}
): Promise<ToolCall[]> {
  let open = false;
  let marked = false;
  return fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          if (readFailsAfterMark && marked) {
            return { status: 502, json: { ok: false, error: 'bridge went away' } };
          }
          return ok({
            success: true,
            worldId: 'w',
            startedAt: open ? '2026-10-08T19:30:00.000Z' : null,
            lastEventAt: null,
            open,
            endedAt: null,
          });
        case 'mark-play-session':
          if (markFails) return { status: 502, json: { ok: false, error: 'bridge is away' } };
          open = (call.args as { action?: string }).action === 'start';
          marked = true;
          return ok({ success: true });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
});

test('Start session marks the log, then the header reads Session since and End session', async ({
  page,
}) => {
  const calls = await fakeBridge(page);
  const switches = await fakeSwitches(page, false);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const status = page.locator('#session-status');
  await expect(status).toHaveText('No session');
  await page.locator('#btn-session').click();

  await expect(toast(page, '✓ Play session started')).toBeVisible();
  await expect(status).toHaveText(/^Session since \d{1,2}:\d{2}/);
  await expect(page.locator('#btn-session')).toHaveText('End session');
  expect(calls.filter(c => c.name === 'mark-play-session').map(c => c.args)).toEqual([
    { action: 'start' },
  ]);
  // A log-only tool: no confirm flags.
  expect(calls.find(c => c.name === 'mark-play-session')?.confirm).toBeUndefined();
  // Start session is the only switch for live play: it turns on GM Actions and the switches too.
  await expect(
    toast(page, '✓ Turn on for tonight. Turned on: Handouts (writes), GM Actions')
  ).toBeVisible();
  expect(switches.posts).toEqual([{ action: 'ready' }]);

  await page.locator('#btn-session').click();
  await expect(toast(page, '✓ Play session ended')).toBeVisible();
  await expect(status).toHaveText('No session');
  await expect(page.locator('#btn-session')).toHaveText('Start session');
});

interface SwitchCalls {
  posts: unknown[];
}

/** The module's switches: `readyOn` has Turn on for tonight on (a write switch and GM Actions). */
async function fakeSwitches(page: Page, readyOn: boolean): Promise<SwitchCalls> {
  const calls: SwitchCalls = { posts: [] };
  const list = (on: boolean): unknown[] => [
    { id: 'handouts', name: 'AI Tool: Handouts (writes)', on },
  ];
  await page.route('**/api/session/switches', route => {
    if (route.request().method() === 'POST') {
      calls.posts.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          ok: true,
          switches: { switches: list(false), ready: null, changed: ['handouts'], failed: [] },
          gmActionsEnabled: false,
          gmActionsChanged: true,
        },
      });
    }
    return route.fulfill({
      json: {
        switches: {
          switches: list(readyOn),
          ready: readyOn ? { at: Date.now(), turnedOn: ['handouts'] } : null,
          changed: [],
          failed: [],
        },
        gmActionsEnabled: readyOn,
        error: null,
      },
    });
  });
  return calls;
}

test('End session also turns off what Turn on for tonight turned on', async ({ page }) => {
  await fakeBridge(page);
  const switches = await fakeSwitches(page, true);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#session-status')).toHaveText('No session');
  await page.locator('#btn-session').click();
  await expect(page.locator('#btn-session')).toHaveText('End session');
  await page.locator('#btn-session').click();

  await expect(toast(page, '✓ Play session ended')).toBeVisible();
  await expect(toast(page, '✓ Turned off again: Handouts (writes), GM Actions')).toBeVisible();
  expect(switches.posts).toEqual([{ action: 'ready' }, { action: 'end' }]);
});

test('End session leaves the switches alone when Ready is not on', async ({ page }) => {
  await fakeBridge(page);
  const switches = await fakeSwitches(page, false);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await page.locator('#btn-session').click();
  await expect(page.locator('#btn-session')).toHaveText('End session');
  await page.locator('#btn-session').click();

  await expect(toast(page, '✓ Play session ended')).toBeVisible();
  await expect(page.locator('#btn-session')).toHaveText('Start session');
  expect(switches.posts).toEqual([{ action: 'ready' }]);
});

test('a mark that worked shows at once when the next read fails, and says so', async ({ page }) => {
  await fakeBridge(page, { readFailsAfterMark: true });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await page.locator('#btn-session').click();

  await expect(toast(page, '✓ Play session started')).toBeVisible();
  await expect(toast(page, '✗ get-play-session: bridge went away')).toBeVisible();
  await expect(page.locator('#session-status')).toHaveText(/^Session since/);
  await expect(page.locator('#btn-session')).toHaveText('End session');
});

test('a failed mark says why and leaves the status alone', async ({ page }) => {
  await fakeBridge(page, { markFails: true });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#session-status')).toHaveText('No session');
  await page.locator('#btn-session').click();

  await expect(toast(page, '✗ mark-play-session: bridge is away')).toBeVisible();
  await expect(page.locator('#session-status')).toHaveText('No session');
  await expect(page.locator('#btn-session')).toBeEnabled();
});

test('a session started in another window shows here without the minute poll', async ({ page }) => {
  // The stream answers only when released: its play-session event lands after the first read.
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/stream**', async route => {
    await released;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 600000\n\nevent: play-session\ndata: {}\n\n',
    });
  });
  const calls = await fakeBridge(page);
  await fakeSwitches(page, false);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.locator('#session-status')).toHaveText('No session');

  // The other window starts the session on the bridge; this one hears about it.
  await page.evaluate(() =>
    fetch('/api/tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mark-play-session', args: { action: 'start' } }),
    })
  );
  release();
  await expect(page.locator('#session-status')).toHaveText(/^Session since \d{1,2}:\d{2}/);
  await expect(page.locator('#btn-session')).toHaveText('End session');
  expect(calls.filter(c => c.name === 'get-play-session').length).toBeGreaterThanOrEqual(2);
});
