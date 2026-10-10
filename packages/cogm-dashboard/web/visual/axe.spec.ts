// Accessibility check (UI-01): axe on every screen at 1440 wide (the other projects skip this file),
// in both themes. Serious and critical violations fail the test, except the ones listed in
// axe-known.ts (found when this check was added; the old page shares the CSS, so they are not
// restyled here). A new violation fails.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { KNOWN_VIOLATIONS } from './axe-known';
import { SCREENS, showScreen } from './screens';

const THEMES = ['neutral', 'veil'] as const;
const FAILING = new Set(['serious', 'critical']);

for (const theme of THEMES) {
  for (const screen of SCREENS) {
    test(`axe: ${screen.name} (${theme})`, async ({ page }) => {
      await showScreen(page, screen, theme);
      const { violations } = await new AxeBuilder({ page }).analyze();

      const found = violations
        .filter(v => v.impact && FAILING.has(v.impact))
        .flatMap(v =>
          v.nodes.map(n => ({
            rule: v.id,
            target: n.target.join(' '),
            why: n.any[0]?.message ?? v.help,
          }))
        );
      const fresh = found.filter(
        f =>
          !KNOWN_VIOLATIONS.some(
            k =>
              k.rule === f.rule &&
              f.target.includes(k.target) &&
              k.screens.includes(screen.name) &&
              k.theme === theme
          )
      );
      expect(fresh, 'serious or critical axe violations that are not in axe-known.ts').toEqual([]);
    });
  }
}
