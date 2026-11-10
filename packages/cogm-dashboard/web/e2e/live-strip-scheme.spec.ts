// The live strip in a Foundry window follows Foundry's light or dark setting (item
// live-screen-b-foundry): /?strip=1&scheme=light shows the light tokens under both world themes
// (neutral and The Veil), and every shown text keeps 4.5:1 against what is behind it. Without the
// parameter the strip keeps the dashboard's dark look. The Foundry side (the address, the message
// when the setting changes) is tested in the module and checked live.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

const FIGHT = [
  {
    id: 'b',
    name: 'Brannoc',
    initiative: 19,
    isCurrentTurn: true,
    hp: { value: 20, max: 28, temp: 0 },
    conditions: ['prone'],
    isPC: true,
    category: 'pc',
    defeated: false,
    deathSaves: null,
    tokenId: 'tk-b',
  },
  {
    id: 'g1',
    name: 'Goblin',
    initiative: 12,
    isCurrentTurn: false,
    hp: { value: 2, max: 7, temp: 0 },
    conditions: [],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    tokenId: 'tk-g1',
  },
];

async function open(page: Page, theme: string, query: string): Promise<void> {
  await fakeCommonRoutes(page, theme);
  // The strip page shows the theme this browser last saw (the Dashboard applies the world's).
  await page.addInitScript(t => localStorage.setItem('cogm_theme', t), theme);
  await fakeTools(page, () => ok({}), { playSession: true });
  await fakeStream(page, [
    { event: 'theme', data: { theme, themes: ['neutral', 'veil'] } },
    { event: 'settings', data: { gmActionsEnabled: true } },
    {
      event: 'status',
      data: {
        controlChannel: 'connected',
        foundry: 'reachable',
        lastError: null,
        lastPollAt: null,
        foundryDownSince: null,
      },
    },
    {
      event: 'combat',
      data: {
        combat: { active: true, round: 2, turn: 0, current: FIGHT[0], combatants: FIGHT },
      },
    },
  ]);
  await page.goto(`/next/?strip=1${query}&token=${GM_TOKEN}`);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(page.locator('#live-strip li[data-id]')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** The worst contrast ratio of any shown text on the page, with the element that has it. */
async function worstContrast(
  page: Page
): Promise<{ ratio: number; where: string; measured: number }> {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], below: number[]): [number, number, number] => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map(i => top[i] * a + below[i] * (1 - a)) as [number, number, number];
    };
    const lum = (c: number[]): number => {
      const f = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    // What is behind the text: the layers from the element up to the first opaque one. Null when
    // an image (a gradient, the hex grid) lies in those layers: there is no one colour to measure.
    const backdrop = (el: Element): [number, number, number] | null => {
      const layers: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (style.backgroundImage !== 'none') return null;
        const bg = rgba(style.backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 0.99) break;
      }
      let base: [number, number, number] = [255, 255, 255];
      for (const bg of layers.reverse()) base = over(bg, base);
      return base;
    };
    let measured = 0;
    let worst = { ratio: 99, where: '', measured: 0 };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim()) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (el.getClientRects().length === 0 || el.closest('[disabled],[aria-disabled="true"]'))
        continue;
      if (el.closest('.sr-only,[hidden]')) continue;
      const bg = backdrop(el);
      if (bg === null) continue;
      measured += 1;
      const fg = over(rgba(style.color), bg);
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < worst.ratio) {
        worst = {
          ratio,
          where: `${el.tagName.toLowerCase()}.${el.className}: ${n.textContent.trim().slice(0, 30)}`,
          measured: 0,
        };
      }
    }
    return { ...worst, measured };
  });
}

for (const theme of ['neutral', 'veil']) {
  test(`the strip is light and readable with ?scheme=light on the ${theme} theme`, async ({
    page,
  }) => {
    await open(page, theme, '&scheme=light');
    await expect(page.locator('html')).toHaveAttribute('data-scheme', 'light');
    const color = await page.evaluate(() => getComputedStyle(document.body).color);
    const ground = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { color: s.backgroundColor, image: s.backgroundImage };
    });
    // Dark text on a flat light ground (no hex grid, no mist).
    expect(color).not.toMatch(/^rgb\((2[0-9]{2}|1[5-9][0-9]),/);
    expect(ground.image).toBe('none');
    expect(ground.color).not.toBe('rgb(15, 17, 21)');
    const worst = await worstContrast(page);
    expect(worst.measured).toBeGreaterThan(8);
    expect(worst.ratio, worst.where).toBeGreaterThanOrEqual(4.5);
  });

  test(`the strip stays dark without a scheme on the ${theme} theme`, async ({ page }) => {
    await open(page, theme, '');
    await expect(page.locator('html')).not.toHaveAttribute('data-scheme', /.+/);
    const worst = await worstContrast(page);
    expect(worst.measured).toBeGreaterThan(8);
    expect(worst.ratio, worst.where).toBeGreaterThanOrEqual(4.5);
  });
}

test('a scheme other than light or dark is ignored', async ({ page }) => {
  await open(page, 'neutral', '&scheme=blue');
  await expect(page.locator('html')).not.toHaveAttribute('data-scheme', /.+/);
});
