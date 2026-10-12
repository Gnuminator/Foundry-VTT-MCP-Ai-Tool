// Help on the React dashboard: the GM guides from the real /api/help route (dist/help.json, made
// by the build), the "?" that opens a pane's own heading, and the error path.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fromMenu } from './support';

const helpPane = (page: Page): Locator => page.locator('#pane-help');

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.goto(`/next/?token=${GM_TOKEN}`);
});

test('GM guides opens the guide index from the server', async ({ page }) => {
  const request = page.waitForRequest(req => req.url().endsWith('/api/help/README'));
  await fromMenu(page, 'btn-guides');
  expect((await request).headers()['x-cogm-token']).toBe(GM_TOKEN);

  const pane = page.getByRole('dialog', { name: 'GM guides' });
  await expect(pane).toBeVisible();
  await expect(pane).toHaveClass(/help-pane/);
  await expect(pane.locator('.help-body h1, .help-body h2').first()).toBeVisible();

  // The same guide is on the wiki; the link opens it in a new tab.
  const wiki = pane.getByRole('link', { name: 'Open this page on the wiki' });
  await expect(wiki).toHaveAttribute(
    'href',
    'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/'
  );
  await expect(wiki).toHaveAttribute('target', '_blank');

  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(pane).toBeHidden();
});

test('the "?" on a pane opens its heading in the guide', async ({ page }) => {
  await fromMenu(page, 'btn-show-diag');
  await page
    .getByRole('dialog', { name: 'Module Diagnostics' })
    .getByRole('button', { name: 'Help for this panel' })
    .click();

  await expect(page.getByRole('dialog', { name: 'The dashboard' })).toBeVisible();
  const heading = helpPane(page).locator('[id="module-diagnostics"]');
  await expect(heading).toBeInViewport();
  // Help sits over the pane that opened it; both stay open.
  await expect(page.getByRole('dialog', { name: 'Module Diagnostics' })).toBeVisible();
});

test('a guide that cannot load says why, and the next open asks again', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/help/**', route => {
    calls += 1;
    return route.fulfill({
      status: 404,
      json: { error: 'The help is built with npm run build (dist/help.json).' },
    });
  });
  await fromMenu(page, 'btn-guides');
  await expect(
    helpPane(page).getByText(
      "Couldn't load the help: The help is built with npm run build (dist/help.json)."
    )
  ).toBeVisible();
  await expect(helpPane(page).getByRole('heading', { level: 2 })).toHaveText('Help');

  await page.getByRole('button', { name: 'Close help' }).click();
  await fromMenu(page, 'btn-guides');
  await expect.poll(() => calls).toBe(2);
});

test('a link inside a guide opens that guide in the same pane, and the wiki link follows', async ({
  page,
}) => {
  await fromMenu(page, 'btn-guides');
  const pane = helpPane(page);
  await expect(pane.locator('.help-body h1')).toBeVisible();
  const wiki = pane.getByRole('link', { name: 'Open this page on the wiki' });
  await expect(wiki).toHaveAttribute(
    'href',
    'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/'
  );

  // The index links to "Getting started"; the link does not navigate the page (href is "#").
  await pane.locator('.help-body a[data-help^="getting-started"]').first().click();
  await expect(page).not.toHaveURL(/#/);
  await expect(pane.locator('.pane-head h2')).toHaveText('Getting started');
  await expect(pane.locator('.help-body h1')).toHaveText('Getting started');
  await expect(wiki).toHaveAttribute(
    'href',
    'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/getting-started/'
  );
});

test('a link to a heading scrolls to it every time, also on the page that is open', async ({
  page,
}) => {
  await fromMenu(page, 'btn-guides');
  const pane = helpPane(page);
  await pane.locator('.help-body a[data-help^="death-and-new-characters"]').first().click();
  await expect(pane.locator('.pane-head h2')).toHaveText('When a character dies');

  const link = pane.locator('.help-body a[data-help="death-and-new-characters#the-death-log"]');
  const heading = pane.locator('[id="the-death-log"]');
  await link.click();
  await expect(heading).toBeInViewport();
  // Back to the top, then the same link again: it has to scroll again.
  await pane.locator('.help-body').evaluate(el => el.closest('.pane-body')?.scrollTo({ top: 0 }));
  await expect(heading).not.toBeInViewport();
  await link.click();
  await expect(heading).toBeInViewport();
});

test('a link out of the guide is left alone', async ({ page }) => {
  await fromMenu(page, 'btn-guides');
  const pane = helpPane(page);
  await expect(pane.locator('.help-body h1')).toBeVisible();
  // Any link without data-help (an external one, or a heading link of the page), clicked with the
  // default action stopped after the pane's own handler: the pane must not have claimed it.
  const claimed = await page.evaluate(() => {
    const link = document.querySelector<HTMLElement>('#pane-help .help-body a:not([data-help])');
    if (!link) return null;
    let prevented = false;
    document.addEventListener(
      'click',
      e => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      },
      { once: true }
    );
    link.click();
    return prevented;
  });
  expect(claimed).toBe(false);
  await expect(pane.locator('.pane-head h2')).toHaveText('GM guides');
});

test('on a narrow screen the help head keeps its title, wiki link and close button on screen', async ({
  page,
}) => {
  const viewport = { width: 375, height: 812 };
  await page.setViewportSize(viewport);
  await fromMenu(page, 'btn-guides');
  const pane = helpPane(page);
  await expect(pane.locator('.help-body h1')).toBeVisible();
  // The longest guide title is the risk: open it through the index.
  await pane.locator('.help-body a[data-help^="features"]').first().click();
  await expect(pane.locator('.pane-head h2')).toHaveText('Features and when to turn them on');

  const parts = [
    pane.locator('.pane-head h2'),
    pane.getByRole('link', { name: 'Open this page on the wiki' }),
    pane.getByRole('button', { name: 'Close help' }),
  ];
  for (const part of parts) {
    await expect(part).toBeVisible();
    const b = await part.boundingBox();
    expect(b).not.toBeNull();
    expect(b?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  }
  // Nothing in the head sticks out of the pane, and the title wraps to at most two lines.
  const head = pane.locator('.pane-head');
  expect(await head.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const lines = await pane
    .locator('.pane-head h2')
    .evaluate(el =>
      Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    );
  expect(lines).toBeLessThanOrEqual(2);
});
