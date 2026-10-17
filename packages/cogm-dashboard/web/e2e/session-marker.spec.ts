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
async function fakeBridge(page: Page, { markFails = false } = {}): Promise<ToolCall[]> {
  let open = false;
  return fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
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

  await page.locator('#btn-session').click();
  await expect(toast(page, '✓ Play session ended')).toBeVisible();
  await expect(status).toHaveText('No session');
  await expect(page.locator('#btn-session')).toHaveText('Start session');
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
