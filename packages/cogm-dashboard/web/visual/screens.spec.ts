// Screenshot tests (UI-01): every screen of the React dashboard in the neutral theme, at the three
// widths of playwright.visual.config.ts. Baselines live in visual/__screenshots__/<project>/ and
// exist for Linux only (the Playwright image; see the README, "Screenshot tests").
//
// One theme per screen: the Veil theme is not photographed here. axe.spec.ts checks both themes
// and the `ui-` primitive stories (stories.spec.ts) pin the Veil tokens. A count of 30 days of CI
// (vault Research/Screenshot shards 2026-11-07) found no bug that a Veil screen shot caught.
import { expect, test } from '@playwright/test';

import { SCREENS, showScreen } from './screens';

const THEME = 'neutral' as const;

for (const screen of SCREENS) {
  test(`${screen.name} (${THEME})`, async ({ page }) => {
    await showScreen(page, screen, THEME);
    await expect(page).toHaveScreenshot(`${screen.name}-${THEME}.png`, {
      fullPage: screen.fullPage,
      // The tool version changes with every release; it must not move every baseline.
      mask: [page.locator('#app-version')],
    });
  });
}
