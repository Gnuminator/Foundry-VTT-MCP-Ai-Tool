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
 * Pages: docs/gm/**, docs/player/** and their docs/da twins (the Danish twins keep the English
 * button names), plus the checklists listed in CHECKLISTS. A missing folder, a missing checklist, no
 * dashboard strings or no names at all fail, so a move cannot shrink the scan unnoticed. The
 * strings are the quoted text and tag text of the sources; comments, stories and quoted lowercase
 * single words (ids, type members) are left out, so a label has to be shown somewhere to count.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const UI_WORDS =
  'button|buttons|tab|tabs|panel|panels|drawer|drawers|switch|switches|toggle|card|cards|link|links|dialog|menu|section|chip|pill|banner|knob|checkbox|row|knap|knappen|knapper|fane|fanen|faner|panelet|skuffen|skuffe|menuen|kontakten';
const VERBS =
  'tick|untick|pick|go to|åbn|brug|slå til|klik|tryk|v[æ]lg|click|clicks|press|presses|tap|taps|hit|choose|select|open|opens|use|uses|switch on|turn on|toggle';

/** Checklists outside docs/gm that also name dashboard controls. */
export const CHECKLISTS = ['docs/dev/SMOKE-TEST.md'];
const DOC_DIRS = ['docs/gm', 'docs/da/gm', 'docs/player', 'docs/da/player'];
const SOURCE_DIRS = [
  'packages/cogm-dashboard/web/src',
  'packages/cogm-dashboard/public',
  'packages/cogm-dashboard/src',
  // Controls the module adds inside Foundry (toolbar buttons, settings menus, windows).
  'packages/foundry-module/src',
  'packages/foundry-module/templates',
  // Commands the Obsidian plugin adds to the command palette.
  'packages/obsidian-plugin/src',
];
const EXCEPTIONS_FILE = 'scripts/docs-ui-exceptions.json';

const walk = (dir, out = [], skip = []) => {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === 'node_modules' || n === 'dist' || n === '__screenshots__' || skip.includes(n)) continue;
      walk(p, out, skip);
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

/** The text with every `open ... close` span cut out (an unclosed one runs to the end). */
function cutSpans(text, open, close) {
  let out = '';
  let pos = 0;
  for (;;) {
    const a = text.indexOf(open, pos);
    if (a < 0) return out + text.slice(pos);
    out += `${text.slice(pos, a)} `;
    const b = text.indexOf(close, a + open.length);
    if (b < 0) return out;
    pos = b + close.length;
  }
}

/**
 * Source without block comments, HTML comments and whole-line or trailing `//` comments. A `/*`
 * inside a string ('/api/help/*', accept="image/*") is no comment: block comments are cut only
 * where they start a line or follow whitespace or an opening bracket, comma, semicolon or `=`.
 */
export function stripSourceComments(text) {
  const blocks = text.replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, '$1 ');
  return cutSpans(blocks, '<!--', '-->')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(\s)\/\/\s.*$/gm, '$1');
}

/** A quoted word such as 'tarokka' or 'drawer-open': an identifier or a type member, not a label. */
const IDENTIFIER = /^[a-z][a-z0-9_-]*$/;

/**
 * Every string a dashboard source file shows: string literals, template text and tag text.
 * Comments are cut first, and a quoted lowercase single word (an id, a type union member, a CSS
 * class) is not taken for a label.
 */
export function sourceStrings(source) {
  const text = stripSourceComments(source);
  const out = [];
  for (const m of text.matchAll(
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  )) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    if (!IDENTIFIER.test(s.trim())) out.push(s);
  }
  for (const m of text.matchAll(/>([^<>{}\n][^<>{}]*)</g)) out.push(m[1]);
  // JSX text on its own line, next to an expression: "  Open {count} items"
  for (const m of text.matchAll(/^\s*([A-Za-z+][^<>{}=;()]*?)\s*$/gm)) out.push(m[1]);
  return out;
}

export function buildCorpus(root) {
  const set = new Set();
  for (const d of SOURCE_DIRS) {
    // Storybook fixtures are not UI text a doc may name.
    for (const f of walk(path.join(root, d), [], ['storybook'])) {
      if (!/\.(tsx?|jsx?|mjs|html)$/.test(f) || /\.(test|spec|stories)\.|\.d\.ts$/.test(f)) continue;
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

/**
 * Bold names next to a UI word, with the line number of the line the name itself is on (the
 * paragraph, list item or table row it sits in is joined into one line before matching). The guides are hard-wrapped, so a block is joined into one line before matching.
 */
export function boldNames(text) {
  const found = [];
  const blocks = [];
  let fence = false;
  let cur = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  text.split('\n').forEach((line, i) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      flush();
      return;
    }
    if (fence) return;
    if (!line.trim() || /^#{1,6}\s/.test(line) || /^\s*:::/.test(line)) return flush();
    const starts = /^\s*(?:[-*+]|\d+\.)\s/.test(line) || /^\s*\|/.test(line);
    if (starts) flush();
    if (!cur) cur = { line: i + 1, text: '', parts: [] };
    cur.parts.push({ at: cur.text.length, line: i + 1 });
    cur.text += ` ${line.trim()}`;
  });
  flush();
  const bold = '\\*\\*([^*]{2,60})\\*\\*';
  const lead = '(?<![\\p{L}\\p{N}])';
  const res = [
    new RegExp(`${bold}(?:\\s+(?:${UI_WORDS})(?![\\p{L}\\p{N}]))`, 'giu'),
    new RegExp(`${lead}(?:${UI_WORDS})\\s+${bold}`, 'giu'),
    new RegExp(`${lead}(?:${VERBS})\\s+(?:on\\s+|the\\s+|på\\s+)*${bold}`, 'giu'),
  ];
  for (const b of blocks) {
    // **`Undo`** is a bold name written as code: drop the backticks (same length, so the line
    // offsets hold); any other code span is blanked, since a bold word inside code is an example.
    const unwrapped = b.text.replace(/\*\*`([^`]*)`\*\*/g, (m, c) => `** ${c} **`);
    const plain = unwrapped.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    for (const re of res) {
      for (const m of plain.matchAll(re)) {
        const name = m[1].replace(/\s+/g, ' ').trim();
        if (!name || /[:.]$/.test(name)) continue; // a label such as **Tip:** or a bold sentence
        // The line the name itself is on, not the line its paragraph starts on.
        const at = m.index + m[0].indexOf('**');
        const line = [...b.parts].reverse().find(p => p.at <= at)?.line ?? b.line;
        if (!found.some(f => f.name === name && f.line === line)) found.push({ name, line });
      }
    }
  }
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
  const problems = [];
  // A moved or renamed folder or checklist must not shrink the scan without a word.
  for (const d of DOC_DIRS) {
    const found = walk(path.join(root, d)).filter(f => f.endsWith('.md'));
    if (!found.length) problems.push(`${d}: no pages found; was the folder moved? Update DOC_DIRS`);
    pages.push(...found);
  }
  for (const c of CHECKLISTS) {
    if (existsSync(path.join(root, c))) pages.push(path.join(root, c));
    else problems.push(`${c}: checklist not found; was it moved? Update CHECKLISTS`);
  }
  if (!corpus.length) problems.push('no dashboard strings found; were the source folders moved?');
  const used = new Set();
  let names = 0;
  for (const f of pages) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    for (const { name, line } of boldNames(readFileSync(f, 'utf8'))) {
      names++;
      const n = normalize(name);
      if (exceptions.has(n)) {
        used.add(n);
        continue;
      }
      if (!inCorpus(name, corpus))
        problems.push(`${rel}:${line}: "${name}" is in no dashboard string`);
    }
  }
  if (!names) problems.push('no bold control names found in any page; did the pages or the matcher change?');
  for (const k of exceptions.keys()) {
    if (!used.has(k))
      problems.push(`${EXCEPTIONS_FILE}: "${k}" is named by no doc any more; remove the exception`);
    else if (inCorpus(k, corpus))
      problems.push(`${EXCEPTIONS_FILE}: "${k}" is now a dashboard string; remove the exception`);
  }
  return { problems, pages: pages.length, corpus: corpus.length, names };
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
