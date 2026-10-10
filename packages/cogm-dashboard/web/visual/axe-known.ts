// Serious and critical axe violations that were already on the React dashboard when the axe check
// was added (UI-01). The CSS is shared with the old page and a fix would change pixels there too,
// so they are recorded here instead of fixed. axe.spec.ts fails on anything not in this list, and
// on an entry here that no longer occurs on its screen and theme. Remove an entry when its cause
// is fixed.
export interface KnownViolation {
  /** The axe rule id. */
  rule: string;
  /**
   * A CSS selector for the offending element or an element around it (`element.closest`). Keep it
   * as specific as the known cause, so a new violation of the same rule on the same screen is not
   * hidden by it.
   */
  target: string;
  /** Why it is still there. */
  reason: string;
  /** Only on these screens (visual/screens.ts names). */
  screens: string[];
  /** Only in this theme. */
  theme: 'neutral' | 'veil';
}

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  {
    rule: 'color-contrast',
    target: '.diag-level',
    reason:
      'Danger red #e63946 on the error badge tint #39242f is 3.43:1 (needs 4.5:1), neutral theme.',
    screens: ['diagnostics'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '.death-saves',
    reason: 'Danger red #e63946 on the panel #1d212b is 3.86:1 (needs 4.5:1), neutral theme.',
    screens: ['party'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '.tarokka-card.veiled',
    reason: 'Muted text #6b7385 on the panel #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    screens: ['tarokka'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '#tool-field-amount-desc',
    reason: 'Muted text #6b7385 on the drawer #171a21 is 3.66:1 (needs 4.5:1), neutral theme.',
    screens: ['tools'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '#advanced-menu .menu-label',
    reason: 'Muted text #6b7385 on the menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    screens: ['advanced-menu'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '#btn-preflight',
    reason: 'Danger red #e63946 on the button #1d212b is 3.86:1 (needs 4.5:1), neutral theme.',
    screens: ['version-banner'],
    theme: 'neutral',
  },
  {
    rule: 'color-contrast',
    target: '.preflight-summary.pf-fail',
    reason:
      'Danger red #e63946 on the Not ready tint #341e26 is 3.7:1 (needs 4.5:1), neutral theme.',
    screens: ['version-banner'],
    theme: 'neutral',
  },
];
