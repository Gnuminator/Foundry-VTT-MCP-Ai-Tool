// Screenshot tests (UI-01): every screen of the React dashboard in both themes, at the three
// widths of playwright.visual.config.ts. Baselines live in visual/__screenshots__/<project>/ and
// exist for Linux only (the Playwright image; see the README, "Screenshot tests").
import { expect, test } from '@playwright/test';

import { SCREENS, showScreen } from './screens';

const THEMES = ['neutral', 'veil'] as const;

for (const theme of THEMES) {
  for (const screen of SCREENS) {
    test(`${screen.name} (${theme})`, async ({ page }) => {
      await showScreen(page, screen, theme);
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: screen.fullPage,
      });
    });
  }
}
