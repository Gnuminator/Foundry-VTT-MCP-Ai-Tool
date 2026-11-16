/**
 * The progress line for a merged item that must stay open (a Pi run or Waiting blocker left, or a
 * done-when step the merge does not finish), or '' when the merge finishes it.
 * @param {Map<string, string[]>} fields the item's fields @param {number} pr
 */
export function openLeft(fields, pr) {
  const piLeft = /^yes\b/i.test(fields.get('pi')?.at(-1) ?? '');
  const waiting = (fields.get('blocked by') ?? []).some(b => /\bW\d+\b/.test(b));
  const step = openStep(fields.get('done when')?.at(-1) ?? '');
  if (piLeft || waiting) {
    return `PR #${pr} merged; the item stays open for its Pi run or Waiting step: close it with done --pi-run (merge runner)`;
  }
  return step
    ? `PR #${pr} merged; the item stays open, its done-when still names ${step}: close it with done once that is finished (merge runner)`
    : '';
}

/**
 * Does an item's done-when name a step that a merge does not finish: a tag, a publish, a ruleset
 * or branch-protection change, or the user's OK? Wording in real items: "tag and publish"
 * (release-v0-29-2), "the ruleset has a merge_queue rule" (github-merge-queue).
 * @param {string} doneWhen the item's `- done when:` text
 * @returns {string} the step found, or ''
 */
export function openStep(doneWhen) {
  const text = String(doneWhen ?? '');
  // An item about the done-when rule itself talks about these words without needing the steps.
  if (/\bdone[- ]when\b/i.test(text)) return '';
  /** @type {[RegExp, string][]} */
  const patterns = [
    // anchored to release and repo-setting shapes: loose words ("published", "tag field") close normally
    [
      /\b(?:git tag|tag(?:ged)? v?\d+\.\d+|tagged and publish|tag the release|release tag)/i,
      'a tag',
    ],
    [/\bpublish(?:ed)? (?:on|to) (?:GitHub|npm|the release)|\bpublish the release\b/i, 'a publish'],
    [
      /\b(?:main )?ruleset (?:has|gets|needs)\b|\bmerge_queue rule\b|\bbranch protection (?:change|rule|setting)/i,
      'a ruleset change',
    ],
    [/\bthe user(?:'s)? (?:OK|go|approval)\b|\buser OK\b|\bthe user says go\b/i, "the user's OK"],
  ];
  for (const [re, name] of patterns) if (re.test(text)) return name;
  return '';
}
