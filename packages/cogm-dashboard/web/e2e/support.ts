// Shared bits of the browser tests: the GM token the test server runs with, and fakes for the
// routes every page load calls.
import type { Page } from '@playwright/test';

export const GM_TOKEN = 'e2e-gm-token';

/** The world's theme and the usage log, so a page load never depends on a bridge. */
export async function fakeCommonRoutes(page: Page, theme = 'veil'): Promise<void> {
  await page.route('**/api/theme', route => route.fulfill({ json: { theme } }));
  await page.route('**/api/usage', route => route.fulfill({ status: 204 }));
}

/**
 * Answers /api/stream with these events once. The long retry keeps EventSource from reconnecting
 * (and replaying them) during the test.
 */
export async function fakeStream(
  page: Page,
  events: { event: string; data: unknown }[]
): Promise<void> {
  const lines = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  const body = `retry: 600000\n\n${lines.join('')}`;
  await page.route('**/api/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  );
}
