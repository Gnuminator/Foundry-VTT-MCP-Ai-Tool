// Serious and critical axe violations that were already in the stories when the story axe check
// was added (UI-03). They come from the old page's shared CSS (a fix would change pixels on the old
// page too), as the ones in axe-known.ts do, or from a component that needs its own fix; they are
// recorded here instead of fixed. stories.spec.ts fails on anything not listed, and on an entry
// that no longer occurs in one of its stories: remove the entry (or the story) when its cause is
// fixed. All of them are in the neutral theme: the Veil stories have none.
export interface KnownStoryViolation {
  /** The axe rule id. */
  rule: string;
  /** A CSS selector for the offending element or one around it (`element.closest`). */
  target: string;
  /** Why it is still there. */
  reason: string;
  /** The story ids (the storybook-static/index.json ids) it occurs in. */
  stories: string[];
}

export const KNOWN_STORY_VIOLATIONS: KnownStoryViolation[] = [
  {
    rule: 'color-contrast',
    target: '.btn-danger',
    reason: 'Danger red #e63946 on the button #1d212b is 3.86:1 (needs 4.5:1), neutral theme.',
    stories: ['ui-button--all-variants', 'ui-button--danger'],
  },
  {
    rule: 'color-contrast',
    target: '.menu-label',
    reason: 'Muted text #6b7385 on the menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: ['components-advancedmenu--open', 'components-advancedmenu--open-phone'],
  },
  {
    rule: 'scrollable-region-focusable',
    target: '.change-diff',
    reason:
      'A long list of changes scrolls inside the confirm window and has nothing focusable in it, so the keyboard cannot scroll it. A fix needs tabindex 0 on the list.',
    stories: ['components-confirmdialog--many-long-lines'],
  },
  {
    rule: 'color-contrast',
    target: '.ref-group',
    reason: 'Muted text #6b7385 on the picker menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: [
      'components-refpicker--open-multiple',
      'components-refpicker--open-single',
      'components-refpicker--phone',
      'panels-tools--form-with-picker-open',
    ],
  },
  {
    rule: 'color-contrast',
    target: '.ref-note',
    reason: 'Muted text #6b7385 on the picker menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: ['components-refpicker--bridge-down', 'components-refpicker--loading'],
  },
  {
    rule: 'aria-required-children',
    target: '.ref-list',
    reason:
      'The picker menu is a listbox even when it has no rows (nothing to pick, or only a note), so it has no option children. A fix belongs in RefPicker (the role only with rows).',
    stories: ['components-refpicker--bridge-down', 'components-refpicker--nothing-to-pick'],
  },
  {
    rule: 'color-contrast',
    target: '.ref-empty',
    reason: 'Muted text #6b7385 on the picker menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: ['components-refpicker--bridge-down', 'components-refpicker--nothing-to-pick'],
  },
  {
    rule: 'color-contrast',
    target: '.diag-level',
    reason:
      'Danger red #e63946 on the error badge tint #39242f is 3.43:1 (needs 4.5:1), neutral theme.',
    stories: [
      'panels-modulediagnostics--errors-and-warnings',
      'panels-modulediagnostics--many-entries',
      'panels-modulediagnostics--phone',
      'panels-modulediagnostics--space-check-overdue',
    ],
  },
  {
    rule: 'scrollable-region-focusable',
    target: '.pane-body',
    reason:
      'A long list of module errors scrolls inside the pane and has nothing focusable in it, so the keyboard cannot scroll it. A fix needs tabindex 0 on the scrolling body.',
    stories: ['panels-modulediagnostics--many-entries'],
  },
  {
    rule: 'color-contrast',
    target: '.death-saves',
    reason: 'Danger red #e63946 on the panel #1d212b is 3.86:1 (needs 4.5:1), neutral theme.',
    stories: [
      'panels-party--eight-characters',
      'panels-party--loaded',
      'panels-party--long-names',
      'panels-party--phone-eight-characters',
    ],
  },
  {
    rule: 'color-contrast',
    target: '.preflight-summary.pf-fail',
    reason:
      'Danger red #e63946 on the Not ready tint #341e26 is 3.7:1 (needs 4.5:1), neutral theme.',
    stories: ['panels-preflight--versions-do-not-match'],
  },
  {
    rule: 'color-contrast',
    target: '#btn-preflight',
    reason: 'Danger red #e63946 on the button #1d212b is 3.86:1 (needs 4.5:1), neutral theme.',
    stories: ['panels-preflight--header-button-to-fix'],
  },
  {
    rule: 'color-contrast',
    target: '.tarokka-card',
    reason: 'Muted text #6b7385 on the panel #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: [
      'panels-tarokka--cards-shown',
      'panels-tarokka--cards-veiled',
      'panels-tarokka--no-reading-yet',
      'panels-tarokka--phone-cards-shown',
      'panels-tarokka--with-obsidian-link',
    ],
  },
  {
    rule: 'color-contrast',
    target: '.tool-cat',
    reason: 'Muted text #6b7385 on the drawer #171a21 is 3.66:1 (needs 4.5:1), neutral theme.',
    stories: ['panels-tools--gm-actions-off', 'panels-tools--tool-list'],
  },
  {
    rule: 'color-contrast',
    target: '.destructive',
    reason: 'Danger red #e63946 on the badge tint #39242f is 3.43:1 (needs 4.5:1), neutral theme.',
    stories: ['panels-tools--gm-actions-off', 'panels-tools--tool-list'],
  },
  {
    rule: 'color-contrast',
    target: '.field-hint',
    reason: 'Muted text #6b7385 on the drawer #171a21 is 3.66:1 (needs 4.5:1), neutral theme.',
    stories: [
      'panels-tools--form-prefilled',
      'panels-tools--form-with-picker-open',
      'panels-tools--missing-required-field',
      'panels-tools--phone',
      'panels-tools--read-result',
    ],
  },
  {
    rule: 'color-contrast',
    target: '#tool-form-error',
    reason: 'Danger red #e63946 on the drawer #171a21 is 4.17:1 (needs 4.5:1), neutral theme.',
    stories: ['panels-tools--missing-required-field'],
  },
];
