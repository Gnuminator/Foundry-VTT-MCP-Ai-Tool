/**
 * Console errors of a run, grouped. The GM page reports every console error and page error with a
 * time and a source; a full run can log hundreds of the same one. This turns the raw list into
 * groups (same normalised message and place) with a count, the first and last time and the
 * scenarios they came from, and marks the groups that are known: findings in
 * data/studio-expected.json whose id starts with "console:" (kind STUDIO, SYSTEM, ...). Anything
 * else is NEW and shows first in the report and in the command's output.
 *
 * Pure functions, no Foundry. The raw list stays in report.json.
 */
import { consoleFindingId } from './studio-compare.mjs';
import { loadExpected } from './studio-expected.mjs';

/**
 * @typedef {{at: string, message: string, source: string, scenario?: string, page?: string}} RawConsoleError
 *   page: 'dashboard' or 'player' for a slice 4 page (absent: the Foundry GM page)
 * @typedef {object} ConsoleGroup
 * @property {string} id         the finding id ("console:gas.captureAdvancement")
 * @property {string} message    the first line, with ids and positions stripped
 * @property {string} source     the place, without host and line numbers ("pageerror" stays)
 * @property {string} [page]     'dashboard' or 'player' for a slice 4 page (absent: the Foundry GM page)
 * @property {number} count
 * @property {string} first      time of the first one
 * @property {string} last       time of the last one
 * @property {string[]} scenarios  scenario ids in order of first appearance ("build" for the build)
 * @property {boolean} known     the id is on the expected list
 * @property {string} [kind]     the expected entry's kind
 * @property {string} [why]      the expected entry's reason
 */

/**
 * A Foundry document id: 16 letters and digits with a digit or both cases in it (so a plain word of
 * 16 letters stays).
 * @param {string} word
 */
const isId = word => /\d/.test(word) || (/[a-z]/.test(word) && /[A-Z]/.test(word));

/** Strips what changes between two errors of the same kind: ids, hosts, line and column numbers. */
function strip(text) {
  return text
    .replace(/https?:\/\/[^/\s)]+\//g, '/')
    .replace(/(\.[a-z0-9]+):\d+(:\d+)?/gi, '$1')
    .replace(/\b[A-Za-z0-9]{16}\b/g, word => (isId(word) ? '<id>' : word))
    .replace(/\s+/g, ' ')
    .trim();
}

/** The source without host and position: "/modules/x/dist/a.js" or "pageerror". @param {string} source */
export function normalizeSource(source) {
  return strip(String(source ?? '').split('?')[0]) || 'console';
}

/**
 * The function name of the first stack line ("at #postNotification (...)"), or ''.
 * @param {string} message
 */
function firstFrame(message) {
  return /^\s*at\s+(?:async\s+)?([^\s(]+)\s*\(/m.exec(message)?.[1] ?? '';
}

/**
 * The first line of a message with ids and positions stripped; for a page error the function the
 * error was thrown in is added, so two page errors from different places stay apart.
 * @param {string} message
 * @param {string} source
 */
export function normalizeMessage(message, source) {
  const text = String(message ?? '');
  const line = strip(text.split(/\r?\n/)[0]).slice(0, 220);
  const fn = source === 'pageerror' ? firstFrame(text) : '';
  return fn ? `${line} (in ${fn})` : line;
}

/** @param {string} text */
const slug = text =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/**
 * The finding id of one console error: the hook it names, else the file it failed to load; a page
 * error gets its own id from the function it was thrown in. An error of a slice 4 page (`e.page`)
 * gets `console:<page>:...`, so it is never taken for a known Foundry finding.
 * @param {RawConsoleError} e
 */
export function consoleErrorId(e) {
  const id = foundryErrorId(e);
  return e.page ? id.replace(/^console:/, `console:${e.page}:`) : id;
}

/** @param {RawConsoleError} e */
function foundryErrorId(e) {
  const message = String(e.message ?? '');
  const source = String(e.source ?? '');
  if (source === 'pageerror' && !/for hook '/.test(message)) {
    const first = message.split(/\r?\n/)[0];
    return `console:pageerror:${slug(firstFrame(message) || first) || 'unknown'}`;
  }
  return consoleFindingId(message, normalizeSource(source));
}

/**
 * The expected console findings (id starts with "console:") of the installed Actor Studio version.
 * @param {string} [file]
 * @param {string | null} [version]  defaults to the version the heroes-studio scenario read
 */
export function loadKnownConsole(file, version) {
  const list = version === undefined ? loadExpected(file) : loadExpected(file, version);
  return list.filter(e => e.id.startsWith('console:'));
}

/**
 * Groups console errors by normalised message and source. Known groups carry the kind and the
 * reason of their entry; the list is sorted with the new groups first, then by count.
 * @param {RawConsoleError[]} errors
 * @param {{known?: Array<{id: string, kind: string, why: string}>}} [opts]  defaults to the list on disk
 * @returns {ConsoleGroup[]}
 */
export function groupConsoleErrors(errors, opts = {}) {
  const known = new Map((opts.known ?? loadKnownConsole()).map(e => [e.id, e]));
  /** @type {Map<string, ConsoleGroup>} */
  const groups = new Map();
  for (const e of errors ?? []) {
    const source = normalizeSource(e.source);
    const message = normalizeMessage(e.message, String(e.source));
    const key = `${message}\u0000${source}${e.page ? `\u0000${e.page}` : ''}`;
    const scenario = e.scenario || '';
    let g = groups.get(key);
    if (!g) {
      const id = consoleErrorId(e);
      const entry = known.get(id);
      g = {
        id,
        message,
        source,
        ...(e.page ? { page: e.page } : {}),
        count: 0,
        first: String(e.at),
        last: String(e.at),
        scenarios: [],
        known: Boolean(entry),
        ...(entry ? { kind: entry.kind, why: entry.why } : {}),
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (String(e.at) < g.first) g.first = String(e.at);
    if (String(e.at) > g.last) g.last = String(e.at);
    if (scenario && !g.scenarios.includes(scenario)) g.scenarios.push(scenario);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.known) - Number(b.known) || b.count - a.count || a.id.localeCompare(b.id)
  );
}

/**
 * Totals of a grouped list.
 * @param {ConsoleGroup[]} groups
 */
export function consoleCounts(groups) {
  const sum = list => list.reduce((n, g) => n + g.count, 0);
  const fresh = groups.filter(g => !g.known);
  return {
    errors: sum(groups),
    groups: groups.length,
    knownErrors: sum(groups.filter(g => g.known)),
    knownGroups: groups.length - fresh.length,
    newErrors: sum(fresh),
    newGroups: fresh.length,
  };
}

/**
 * A few lines for the end of a run: the totals and every new group.
 * @param {ConsoleGroup[]} groups
 * @returns {string[]}
 */
export function consoleSummaryLines(groups) {
  const c = consoleCounts(groups);
  if (!c.errors) return ['console errors: none'];
  const lines = [
    `console errors: ${c.errors} in ${c.groups} groups (${c.knownErrors} known in ${c.knownGroups}, ` +
      `${c.newErrors} NEW in ${c.newGroups})`,
  ];
  for (const g of groups.filter(x => !x.known).slice(0, 8)) {
    lines.push(`  NEW x${g.count} [${g.scenarios.join(', ') || '-'}] ${g.message} (${g.source})`);
  }
  if (c.newGroups > 8) lines.push(`  ... and ${c.newGroups - 8} more new groups`);
  return lines;
}
