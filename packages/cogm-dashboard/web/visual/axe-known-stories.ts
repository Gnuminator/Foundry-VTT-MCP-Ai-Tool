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
    target: '.menu-label',
    reason: 'Muted text #6b7385 on the menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: [
      'components-advancedmenu--open',
      'components-advancedmenu--open-phone',
      'components-during-layouts--menu-combat-buttons-on',
      'components-during-layouts--menu-open',
      'components-during-layouts--menu-open-phone',
      'components-during-layouts--menu-waiting-for-the-world',
    ],
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
    rule: 'color-contrast',
    target: '.ref-empty',
    reason: 'Muted text #6b7385 on the picker menu #1d212b is 3.38:1 (needs 4.5:1), neutral theme.',
    stories: ['components-refpicker--bridge-down', 'components-refpicker--nothing-to-pick'],
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
];
