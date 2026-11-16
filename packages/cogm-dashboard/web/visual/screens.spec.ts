// Page shots (UI-01): every screen of the React dashboard in the neutral theme, at the three
// widths of playwright.visual.config.ts. They are rendered on every run and uploaded as an
// artifact, not compared with committed PNGs (see page-shot.ts and the README, "Screenshot tests").
//
// One theme per screen: the Veil theme is not photographed here. axe.spec.ts checks both themes
// and the `ui-` primitive stories (stories.spec.ts) pin the Veil tokens. A count of 30 days of CI
// (vault Research/Screenshot shards 2026-11-07) found no bug that a Veil screen shot caught.
import { test } from '@playwright/test';

import { pageShot } from './page-shot';
import { SCREENS, showScreen } from './screens';

const THEME = 'neutral' as const;

for (const screen of SCREENS) {
  test(`${screen.name} (${THEME})`, async ({ page }, info) => {
    await showScreen(page, screen, THEME);
    // A page shot: rendered and kept as the CI artifact, not compared (see page-shot.ts).
    await pageShot(page, info, `${screen.name}-${THEME}.png`, {
      fullPage: screen.fullPage,
      mask: [page.locator('#app-version')],
    });
  });
}
