// The screens the visual tests photograph: the three moments with their panels docked in the
// page, each drawer over the page, the Advanced menu, and the version banner. One list, used by
// the screenshot tests and by the axe check, so both look at the same states.
import { expect, type Page } from '@playwright/test';

import { GM_TOKEN, fromMenu } from '../e2e/support';

import { fakeDashboard, type Moment, type Setup, type Theme } from './fixtures';

export interface Screen {
  /** The file stem of the baseline, and the test title. */
  name: string;
  /** The play session behind the screen; it decides the moment and which panels are docked. */
  moment: Moment;
  /** The whole page (the moments) or just the window (a drawer is fixed to the window). */
  fullPage: boolean;
  versionMismatch?: boolean;
  moduleErrors?: boolean;
  /** Gets the screen into its state and waits until its content is on the page. */
  show: (page: Page) => Promise<void>;
}

const dialog = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page.getByRole('dialog', { name });

/** A moment with its docked panels loaded. */
const inPage =
  (moment: Moment, ...texts: string[]) =>
  async (page: Page): Promise<void> => {
    await expect(page.locator(`#tab-${moment}`)).toHaveAttribute('aria-selected', 'true');
    for (const text of texts) {
      await expect(page.locator(`#moment-${moment}`).getByText(text).first()).toBeVisible();
    }
  };

export const SCREENS: Screen[] = [
  {
    name: 'before',
    moment: 'before',
    fullPage: true,
    show: inPage('before', 'Hidden tokens', 'Find the missing ferry'),
  },
  {
    name: 'during',
    moment: 'during',
    fullPage: true,
    // Cards starts with Handouts and Party folded: the shot opens Handouts (Party stays folded,
    // as it does for a GM on a wide screen) and shows both heads.
    show: async (page): Promise<void> => {
      await page.locator('[data-fold="handouts"]').click();
      await inPage('during', 'Torn ledger page')(page);
      // The Live Feed has its events (on a phone it starts folded: the head and the count show).
      await expect(page.locator('#feed-meta')).toHaveText('8 events');
      await expect(
        page.locator('#party-drawer').getByRole('heading', { name: /Party/ })
      ).toBeVisible();
    },
  },
  {
    name: 'after',
    moment: 'after',
    fullPage: true,
    show: inPage('after', 'Find the missing ferry', 'Torn ledger page'),
  },
  {
    name: 'player-links',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-show-links');
      await expect(dialog(page, 'Player links').getByText('Nell')).toBeVisible();
    },
  },
  {
    name: 'diagnostics',
    moment: 'before',
    fullPage: false,
    moduleErrors: true,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-show-diag');
      await expect(dialog(page, 'Module Diagnostics').getByText('No stack to tell')).toBeVisible();
    },
  },
  {
    // Pre-flight and Prep sit in the page in Before and After: over During they are drawers.
    name: 'preflight',
    moment: 'during',
    fullPage: false,
    show: async (page): Promise<void> => {
      await page.locator('#btn-preflight').click();
      await expect(dialog(page, '✈ Pre-flight').getByText('Starting scene').first()).toBeVisible();
      await expect(dialog(page, '✈ Pre-flight').locator('#ready-block')).toBeVisible();
    },
  },
  {
    name: 'prep',
    moment: 'during',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-prep');
      await expect(dialog(page, '📋 Prep').getByText('Find the missing ferry')).toBeVisible();
    },
  },
  {
    // Party and Handouts sit in the page during a session: over Before they are drawers.
    name: 'party',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-party');
      await expect(dialog(page, '🛡 Party').getByText('Brenna')).toBeVisible();
    },
  },
  {
    name: 'handouts',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-handouts');
      await expect(dialog(page, '📜 Handouts').getByText('Wanted poster')).toBeVisible();
    },
  },
  {
    name: 'tarokka',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-tarokka');
      await expect(dialog(page, '🃏 Tarokka').getByText('Second lantern')).toBeVisible();
    },
  },
  {
    name: 'tools',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await fromMenu(page, 'btn-tools');
      const drawer = dialog(page, '🛠 Tool Runner');
      await drawer.locator('[data-tool="plan-actor-change"]').click();
      await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-actor-change');
    },
  },
  {
    name: 'advanced-menu',
    moment: 'before',
    fullPage: false,
    show: async (page): Promise<void> => {
      await page.locator('#btn-advanced').click();
      await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeVisible();
    },
  },
  {
    // The only page-wide banner on the React page so far (the bridge-down notice is not ported).
    name: 'version-banner',
    moment: 'before',
    fullPage: true,
    versionMismatch: true,
    show: async (page): Promise<void> => {
      await expect(page.locator('#version-banner')).toBeVisible();
      await inPage('before', 'Find the missing ferry')(page);
    },
  },
];

/**
 * Loads the dashboard as the screen needs it and brings it to its state. Settles the page the
 * same way every time: fonts loaded, the mouse out of the way (no hover state), nothing in flight.
 */
export async function showScreen(page: Page, screen: Screen, theme: Theme): Promise<void> {
  const setup: Setup = {
    theme,
    moment: screen.moment,
    ...(screen.versionMismatch ? { versionMismatch: true } : {}),
    ...(screen.moduleErrors ? { moduleErrors: true } : {}),
  };
  await fakeDashboard(page, setup);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('data-mist', 'calm');
  await screen.show(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(0, 0);
}
