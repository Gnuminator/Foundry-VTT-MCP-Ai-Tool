// Shared bits of the browser tests: the GM token the test server runs with, and fakes for the
// routes every page load calls.
import type { Locator, Page } from '@playwright/test';

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

/**
 * A toast in the stack. Radix also repeats each toast's text in a screen-reader live region
 * outside the stack, so a page-wide getByText can match twice.
 */
export const toast = (page: Page, text: string): Locator =>
  page.locator('.toast-stack').getByText(text);

/** One POST /api/tool body: the tool, its args and the confirm flags of a write. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  confirm?: boolean;
  confirmDestructive?: boolean;
}

/** Answers POST /api/tool by tool name and records each call. */
export async function fakeTools(
  page: Page,
  answer: (call: ToolCall) => { status?: number; json: unknown }
): Promise<ToolCall[]> {
  const calls: ToolCall[] = [];
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    calls.push(call);
    const { status = 200, json } = answer(call);
    return route.fulfill({ status, json });
  });
  return calls;
}

/** A tool's answer when it worked. */
export const ok = (result: unknown): { json: unknown } => ({ json: { ok: true, result } });

/**
 * Picks an entry of the Advanced ▾ menu (its old page id): a click on the menu, then on the
 * entry; or from the keyboard, which also works while a drawer's backdrop covers the header.
 */
export async function fromMenu(page: Page, id: string, keyboard = false): Promise<void> {
  if (keyboard) {
    await page.locator('#btn-advanced').press('Enter');
    await page.locator(`#advanced-menu #${id}`).press('Enter');
  } else {
    await page.locator('#btn-advanced').click();
    await page.locator(`#advanced-menu #${id}`).click();
  }
}
