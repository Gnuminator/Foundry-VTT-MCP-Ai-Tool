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
    ? `PR #${pr} merged; the item stays open, its done-when names a ${step} step: close it with done once that is finished (merge runner)`
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
  /** @type {[RegExp, string][]} */
  const patterns = [
    // a git tag, not a "tag" in a data or UI sense
    [/\b(?:git tag|a tag|tag(?:ged)? (?:v?\d|and|the release|it))\b/i, 'tag'],
    [/\b(?:the )?release (?:tag|is published)\b/i, 'tag'],
    [/\bpublish(?:ed|es|ing)?\b/i, 'publish'],
    [/\b(?:ruleset|merge_queue|branch protection)\b/i, 'ruleset change'],
    [/\b(?:the user(?:'s)? (?:OK|go|approval)|user's OK|user OK)\b/i, "the user's OK"],
  ];
  for (const [re, name] of patterns) if (re.test(text)) return name;
  return '';
}
