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
      /\b(?:git tag|tag(?:ged)?\b.{0,40}\b(?:release|v?\d+\.\d+|publish)|(?:release|version) tag)/i,
      'a tag',
    ],
    [
      /\b(?:release|installer|package|build)\b.{0,30}\bpublish|\bpublish(?:ed)?\b.{0,30}\b(?:release|installer|GitHub|npm)/i,
      'a publish',
    ],
    [
      /\bruleset\b.{0,40}\b(?:has|gets|needs|requires|updated|change|merge[ _]queue)|\bmerge[ _]queue\b.{0,30}\bruleset|\bmerge_queue rule\b|\bbranch protection\b.{0,20}\b(?:change|rule|setting|update|requires)/i,
      'a ruleset change',
    ],
    [
      /\b(?:the )?user(?:'s)?\s+(?:says\s+|gives\s+the\s+)?(?:OK|go|approv\w*)\b|\buser OK\b|\bapproval from the user\b/i,
      "the user's OK",
    ],
  ];
  for (const [re, name] of patterns) if (re.test(text)) return name;
  return '';
}
