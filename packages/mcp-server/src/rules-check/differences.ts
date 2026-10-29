/**
 * Where the 2014 and 2024 rules differ for an action the rules check can recognise by name (I-126).
 * Own short paraphrases of mechanics, not book text: keep each note to one sentence per version.
 * No I/O; `evaluateAction` adds a `rules-differences` line from `differenceFor`.
 */

export interface RuleDifference {
  /** Short name for the line ("Counterspell"). */
  topic: string;
  /** Matched against the item name. */
  match: RegExp;
  /** Only for spells (true), only for non-spells (false), or both (missing). */
  spell?: boolean;
  rules2014: string;
  rules2024: string;
}

export const RULE_DIFFERENCES: RuleDifference[] = [
  {
    topic: 'Counterspell',
    match: /^counterspell$/i,
    spell: true,
    rules2014:
      'the target spell stops on its own if it is no higher than the slot used; a higher one needs an ability check.',
    rules2024:
      'the caster of the target spell makes a Constitution save against the counterspeller, and the spell fails only on a failed save.',
  },
  {
    topic: 'Grapple',
    match: /\bgrapple\b/i,
    spell: false,
    rules2014:
      'a contested Strength (Athletics) check against Athletics or Acrobatics, made in place of one attack.',
    rules2024:
      "an unarmed strike option: the target saves with Strength or Dexterity against a DC built from the grappler's Strength modifier and proficiency bonus.",
  },
  {
    topic: 'Shove',
    match: /\bshove\b/i,
    spell: false,
    rules2014: 'a contested Strength (Athletics) check, made in place of one attack.',
    rules2024:
      "an unarmed strike option: the target saves with Strength or Dexterity against a DC built from the shover's Strength modifier and proficiency bonus.",
  },
  {
    topic: 'Hide',
    match: /^hide$/i,
    spell: false,
    rules2014: 'a Dexterity (Stealth) check, set against what the others notice (Perception).',
    rules2024:
      'a Dexterity (Stealth) check against a fixed DC 15, and the hider needs three-quarters or total cover or heavy obscurement, out of sight.',
  },
];

/** The difference note for an item, or undefined when the two rule sets do not differ for it. */
export function differenceFor(item: string, isSpell: boolean): RuleDifference | undefined {
  const name = item.trim();
  return RULE_DIFFERENCES.find(
    d => d.match.test(name) && (d.spell === undefined || d.spell === isSpell)
  );
}
