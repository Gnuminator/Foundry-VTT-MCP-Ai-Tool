#!/usr/bin/env node
/**
 * Fails when a doc names a dashboard control that the dashboard does not have.
 *
 * The GM docs and the checklists say things like "press the **Start session** button" or "open the
 * **Tarokka** drawer". When a button is renamed those sentences go stale without any test noticing.
 * This reads every bold name that sits next to a UI word (button, tab, panel, drawer, switch, ...) or
 * after "Click" / "Press" / "Tap", and looks for it among the strings of the dashboard source
 * (packages/cogm-dashboard: the React app, the player page, the server-rendered pages). A name that is
 * in no string must be listed in scripts/docs-ui-exceptions.json (Foundry's own buttons and the like),
 * with the reason.
 *
 *   node scripts/docs-ui-check.mjs            check, exit 1 on a name nobody has
 *   node scripts/docs-ui-check.mjs --root d   check another tree (tests)
 *
 * Pages: docs/gm/** and docs/da/gm/** (the Danish twins keep the English button names), plus the
 * checklists listed in CHECKLISTS.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const UI_WORDS =
  'button|buttons|tab|tabs|panel|panels|drawer|drawers|switch|switches|toggle|card|cards|link|links|dialog|menu|section|chip|pill|banner|knob|checkbox|row';
const VERBS =
  'click|clicks|press|presses|tap|taps|hit|choose|select|open|opens|use|uses|switch on|turn on|toggle';

/** Checklists outside docs/gm that also name dashboard controls. */
export const CHECKLISTS = ['docs/dev/SMOKE-TEST.md'];
const DOC_DIRS = ['docs/gm', 'docs/da/gm'];
const SOURCE_DIRS = [
  'packages/cogm-dashboard/web/src',
  'packages/cogm-dashboard/public',
  'packages/cogm-dashboard/src',
  // Controls the module adds inside Foundry (toolbar buttons, settings menus, windows).
  'packages/foundry-module/src',
  'packages/foundry-module/templates',
];
const EXCEPTIONS_FILE = 'scripts/docs-ui-exceptions.json';

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === 'node_modules' || n === 'dist' || n === '__screenshots__') continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
};

/** Lower case, no emoji or arrows or trailing dots, one space between words. */
export function normalize(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'’/&+?-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Every string a dashboard source file shows: string literals, template text and tag text. */
export function sourceStrings(text) {
  const out = [];
  for (const m of text.matchAll(
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  )) {
    out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
  }
  for (const m of text.matchAll(/>([^<>{}\n][^<>{}]*)</g)) out.push(m[1]);
  // JSX text on its own line, next to an expression: "  Open {count} items"
  for (const m of text.matchAll(/^\s*([A-Za-z][^<>{}=;()]*?)\s*$/gm)) out.push(m[1]);
  return out;
}

export function buildCorpus(root) {
  const set = new Set();
  for (const d of SOURCE_DIRS) {
    for (const f of walk(path.join(root, d))) {
      if (!/\.(tsx?|jsx?|mjs|html)$/.test(f) || /\.(test|spec)\.|\.d\.ts$/.test(f)) continue;
      for (const s of sourceStrings(readFileSync(f, 'utf8'))) {
        const n = normalize(s);
        if (n) set.add(n);
      }
    }
  }
  return [...set];
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function inCorpus(name, corpus) {
  // A doc writes "Start combat with N" for a label the source builds as `Start combat with ${n}`.
  const n = normalize(name).replace(/ n$/, '');
  if (!n) return true;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(n)}([^\\p{L}\\p{N}]|$)`, 'u');
  // A label is short: a long sentence that happens to hold the words does not count.
  const maxWords = n.split(' ').length + 3;
  return corpus.some(s => s.includes(n) && s.split(' ').length <= maxWords && re.test(s));
}

/** Bold names next to a UI word, with their line numbers. */
export function boldNames(text) {
  const found = [];
  const lines = text.split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const plain = line.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    const bold = '\\*\\*([^*]{2,60})\\*\\*';
    const res = [
      new RegExp(`${bold}(?:\\s+(?:${UI_WORDS})\\b)`, 'gi'),
      new RegExp(`\\b(?:${UI_WORDS})\\s+${bold}`, 'gi'),
      new RegExp(`\\b(?:${VERBS})\\s+(?:on\\s+|the\\s+)*${bold}`, 'gi'),
    ];
    for (const re of res) {
      for (const m of plain.matchAll(re)) {
        const name = m[1].trim();
        if (/[:]$/.test(name)) continue; // a label such as **Tip:**
        if (!found.some(f => f.name === name && f.line === i + 1))
          found.push({ name, line: i + 1 });
      }
    }
  });
  return found;
}

export function loadExceptions(root) {
  const file = path.join(root, EXCEPTIONS_FILE);
  if (!existsSync(file)) return new Map();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const map = new Map();
  for (const e of data.names ?? []) map.set(normalize(e.name), e.reason);
  return map;
}

export function check(root) {
  const corpus = buildCorpus(root);
  const exceptions = loadExceptions(root);
  const pages = [];
  for (const d of DOC_DIRS) {
    for (const f of walk(path.join(root, d))) if (f.endsWith('.md')) pages.push(f);
  }
  for (const c of CHECKLISTS) if (existsSync(path.join(root, c))) pages.push(path.join(root, c));
  const problems = [];
  const used = new Set();
  for (const f of pages) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    for (const { name, line } of boldNames(readFileSync(f, 'utf8'))) {
      const n = normalize(name);
      if (exceptions.has(n)) {
        used.add(n);
        continue;
      }
      if (!inCorpus(name, corpus))
        problems.push(`${rel}:${line}: "${name}" is in no dashboard string`);
    }
  }
  for (const k of exceptions.keys()) {
    if (!used.has(k))
      problems.push(`${EXCEPTIONS_FILE}: "${k}" is named by no doc any more; remove the exception`);
    else if (inCorpus(k, corpus))
      problems.push(`${EXCEPTIONS_FILE}: "${k}" is now a dashboard string; remove the exception`);
  }
  return { problems, pages: pages.length, corpus: corpus.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root =
    rootArg > -1
      ? path.resolve(process.argv[rootArg + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { problems, pages, corpus } = check(root);
  if (problems.length) {
    console.error(
      `docs-ui: ${problems.length} problem(s). A doc names a control the dashboard does not have:`
    );
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      `Fix the doc (and its Danish twin) or, for a Foundry button, add the name with a reason to ${EXCEPTIONS_FILE}.`
    );
    process.exit(1);
  }
  console.log(
    `docs-ui: ${pages} pages checked against ${corpus} dashboard strings, all names found`
  );
}
