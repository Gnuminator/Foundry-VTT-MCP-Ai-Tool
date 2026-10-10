// Accessibility check (UI-01): axe on every screen at 1440 wide (the other projects skip this file),
// in both themes. Serious and critical violations fail the test, except the ones listed in
// axe-known.ts (found when this check was added; the old page shares the CSS, so they are not
// restyled here). A new violation fails, and so does a known entry that no longer occurs on its
// screen and theme (its cause is fixed: remove the entry).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { KNOWN_VIOLATIONS, type KnownViolation } from './axe-known';
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
            // The one selector axe reports for a node in the page itself (not in a frame or shadow
            // tree); the known entry's selector is matched against that element.
            selector: n.target.length === 1 && typeof n.target[0] === 'string' ? n.target[0] : null,
            why: n.any[0]?.message ?? v.help,
          }))
        );

      // The known entries that apply to this screen and theme, and which of them were seen.
      const applicable = KNOWN_VIOLATIONS.filter(
        k => k.theme === theme && k.screens.includes(screen.name)
      );
      const seen = new Set<KnownViolation>();
      const fresh: typeof found = [];
      for (const f of found) {
        let known = false;
        for (const k of applicable) {
          if (k.rule !== f.rule || f.selector === null) continue;
          // The node is the entry's element or inside it (axe may name a child, such as the
          // <code> in a card, and spells its own selector, which need not look like the entry's).
          const hit = await page.evaluate(
            ([axeSelector, knownSelector]) =>
              document.querySelector(axeSelector)?.closest(knownSelector) != null,
            [f.selector, k.target] as const
          );
          if (hit) {
            seen.add(k);
            known = true;
          }
        }
        if (!known) fresh.push(f);
      }
      expect(fresh, 'serious or critical axe violations that are not in axe-known.ts').toEqual([]);

      const stale = applicable.filter(k => !seen.has(k)).map(k => `${k.rule}: ${k.target}`);
      expect(stale, 'axe-known.ts entries that no longer occur here: remove them').toEqual([]);
    });
  }
}
