// The layout trial on the old page at the root (public/app.js): the pin the page had before the
// trial belongs to the play session that was open then. The bridge and the stream are faked in
// the browser; the React dashboard's own trial is in during-layouts.spec.ts.
import { expect, test } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

const PREFS = {
  duringLayout: 'layered',
  duringFull: false,
  combatButtons: false,
  layoutPicked: false,
  hintDismissed: true,
  hintSessions: [],
};

test('Stop after the session opened mid-trial lands on During, unpinned', async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, [{ event: 'prefs', data: PREFS }]);
  let open = false;
  let endedAt: string | null = null;
  await fakeTools(
    page,
    call => {
      if (call.name === 'get-play-session') {
        return ok({ open, startedAt: open ? new Date().toISOString() : null, endedAt });
      }
      if (call.name === 'mark-play-session') {
        open = call.args['action'] === 'start';
        endedAt = open ? null : new Date().toISOString();
      }
      return ok({});
    },
    { playSession: true }
  );
  await page.goto(`/?token=${GM_TOKEN}`);
  await expect(page.locator('#btn-session')).toHaveText('Start session');

  // The GM pinned Before, then started the trial: both belong to the session that was open.
  await page.locator('#moments [data-moment="before"]').click();
  await page.locator('#btn-layout-trial').click();
  await expect(page.locator('#moments [data-moment="during"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.locator('#btn-session').click();
  await expect(page.locator('#btn-session')).toHaveText('End session');

  await page.locator('#layout-tour-stop').click();
  await expect(page.locator('#layout-tour')).toBeHidden();
  // The old pin on Before is not brought back: the new session shows During.
  await expect(page.locator('#moments [data-moment="during"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // And nothing stays pinned: ending the session moves the page off During.
  await page.locator('#btn-session').click();
  await expect(page.locator('#btn-session')).toHaveText('Start session');
  await expect(page.locator('#moments [data-moment="during"]')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});
