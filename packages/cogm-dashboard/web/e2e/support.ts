// Shared bits of the browser tests: the GM token the test server runs with, and fakes for the
// routes every page load calls.
import type { Page } from '@playwright/test';

export const GM_TOKEN = 'e2e-gm-token';

/** The world's theme and the usage log, so a page load never depends on a bridge. */
export async function fakeCommonRoutes(page: Page, theme = 'veil'): Promise<void> {
  await page.route('**/api/theme', route => route.fulfill({ json: { theme } }));
  await page.route('**/api/usage', route => route.fulfill({ status: 204 }));
}
