// Screenshot and axe tests for the player pages (/player and /me): the screens of
// player-screens.ts. Screenshots run at the laptop and phone widths (the widths players use; the
// 1440 project only runs the axe check), baselines in visual/__screenshots__/<project>/ like the
// dashboard's (Linux only, see the README, "Screenshot tests").
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { PLAYER_SCREENS, showPlayerScreen } from './player-screens';

const FAILING = new Set(['serious', 'critical']);

for (const screen of PLAYER_SCREENS) {
  test(`${screen.name}`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-1440', 'the 1440 project only runs the axe check');
    await showPlayerScreen(page, screen);
    await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true });
  });

  test(`axe: ${screen.name}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'axe runs once, at 1440');
    await showPlayerScreen(page, screen);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const found = violations
      .filter(v => v.impact && FAILING.has(v.impact))
      .flatMap(v =>
        v.nodes.map(n => `${v.id}: ${n.target.join(' ')} (${n.any[0]?.message ?? v.help})`)
      );
    expect(found, 'serious or critical axe violations on this player page').toEqual([]);
  });
}
