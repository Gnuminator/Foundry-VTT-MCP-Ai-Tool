/**
 * Reads the `run:` commands of a job in a workflow file (.github/workflows/ci.yml) with a YAML
 * parser. Kept apart from scripts/checks.mjs so that file stays plain data with no dependency
 * (the merge gate may have to run a copy of it away from node_modules).
 */
import yaml from 'js-yaml';

/** Collapse whitespace so a command compares the same however the YAML wrapped it. @param {string} s */
export function normalizeCommand(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The steps of one job in a parsed workflow file.
 * @param {string} yamlText @param {string} job
 * @returns {Array<Record<string, unknown>>}
 */
function jobSteps(yamlText, job) {
  const doc = /** @type {any} */ (yaml.load(yamlText));
  const steps = doc?.jobs?.[job]?.steps;
  return Array.isArray(steps) ? steps : [];
}

/**
 * Every `run:` command of one job in a workflow file, in order, without `npm ci`: a single-line
 * `run:` is one command (a folded plain scalar is already joined by the parser), a `run: |` block
 * is one command per non-empty, non-comment line.
 * @param {string} yamlText @param {string} [job]
 * @returns {string[]}
 */
export function ciRunCommands(yamlText, job = 'build-test') {
  const commands = [];
  for (const step of jobSteps(yamlText, job)) {
    if (typeof step.run !== 'string') continue;
    for (const line of step.run.split(/\r?\n/)) {
      const text = line.trim();
      if (text && !text.startsWith('#')) commands.push(text);
    }
  }
  return commands.filter(c => normalizeCommand(c) !== 'npm ci');
}

/**
 * Parts of a job that change what a `run:` command does and that ciRunCommands does not follow
 * (`working-directory`). The parity test fails while there are any, so a new one is noticed.
 * @param {string} yamlText @param {string} [job]
 * @returns {string[]}
 */
export function ciUnsupported(yamlText, job = 'build-test') {
  const found = [];
  for (const step of jobSteps(yamlText, job)) {
    if (typeof step['working-directory'] === 'string') {
      found.push(`working-directory: ${step['working-directory']}`);
    }
  }
  return found;
}
