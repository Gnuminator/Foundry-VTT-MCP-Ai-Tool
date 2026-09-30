#!/usr/bin/env node
/**
 * Usage catalogue generator (I-084, docs/design/USAGE-LOG.md).
 *
 * Scans the source for every control that reports usage and writes the list to
 * `shared/src/usage-catalog.generated.ts`, so the Obsidian usage note can say
 * which controls were never used.
 *
 *   dashboard and /player   packages/cogm-dashboard/public/*.{html,js}
 *     data-track="dash.x.y"                      kind `action` (or `data-track-kind="view"`)
 *     track('kind', 'name')  trackView('name')  trackShortcut('name')  trackError('name')
 *   Foundry module          packages/foundry-module/src/**\/*.ts (not tests)
 *     trackUsage('kind', 'name')
 *
 * Names must be string literals. A call with a computed name, a name that does
 * not match the contract, or one on the wrong surface is an error (exit 1): the
 * catalogue cannot list what it cannot read. `usage.js` and `usage-recorder.ts`
 * (the definitions) are not scanned.
 *
 *   node scripts/usage-catalog.mjs            write the generated file
 *   node scripts/usage-catalog.mjs --check    exit 1 when the file is stale or a name is bad
 *   --root <dir>                              scan another tree (tests)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KINDS = ['view', 'action', 'tool', 'shortcut', 'error'];
const NAME_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,4}$/;
const NAME_MAX = 80;
const SURFACE_PREFIX = [
  ['dash.', 'dashboard'],
  ['tool.', 'dashboard'],
  ['player.', 'player'],
  ['module.', 'module'],
];
const OUTPUT = 'shared/src/usage-catalog.generated.ts';
const DASHBOARD_DIR = 'packages/cogm-dashboard/public';
const MODULE_DIR = 'packages/foundry-module/src';
const DEFINITION_FILES = new Set([`${DASHBOARD_DIR}/usage.js`, `${MODULE_DIR}/usage-recorder.ts`]);

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, accept, out);
    } else if (accept(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Replace comments with spaces (same length, so line numbers survive). */
function stripComments(text, isHtml) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  let out = text;
  if (isHtml) return out.replace(/<!--[\s\S]*?-->/g, blank);
  out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  return out.replace(/(^|[^:'"`\\])(\/\/[^\n]*)/g, (_m, pre, comment) => pre + blank(comment));
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const STR = `(?:'([^'\\\\\\n]*)'|"([^"\\\\\\n]*)"|\`([^\`\\\\$\\n]*)\`)`;
const pick = m => m.slice(1).find(v => v !== undefined);

/** Scan one file's text; returns `{ found: [{name, kind}], problems: [string] }`. */
export function scanText(text, file, isHtml) {
  const found = [];
  const problems = [];
  const src = stripComments(text, isHtml);

  // data-track="name" (kind action unless data-track-kind is set on the same tag)
  const attr = /\bdata-track=(?:"([^"]*)"|'([^']*)')/g;
  for (let m = attr.exec(src); m; m = attr.exec(src)) {
    const name = m[1] ?? m[2];
    const open = src.lastIndexOf('<', m.index);
    const close = src.indexOf('>', m.index);
    const tag = src.slice(open < 0 ? 0 : open, close < 0 ? src.length : close);
    const kindMatch = /\bdata-track-kind=(?:"([^"]*)"|'([^']*)')/.exec(tag);
    found.push({ name, kind: kindMatch ? (kindMatch[1] ?? kindMatch[2]) : 'action', at: m.index });
  }

  // track('kind', 'name') / trackUsage('kind', 'name') / trackView('name') / ...
  const call = /(^|[^\w$])(?<fn>track|trackUsage|trackView|trackShortcut|trackError)\s*\(/g;
  for (let m = call.exec(src); m; m = call.exec(src)) {
    const before = src.slice(Math.max(0, m.index - 12), m.index + m[1].length);
    if (/\bfunction\s*$/.test(before)) continue;
    const fn = m.groups.fn;
    const rest = src.slice(call.lastIndex);
    const at = m.index + m[1].length;
    if (fn === 'track' || fn === 'trackUsage') {
      const re = new RegExp(`^\\s*${STR}\\s*,\\s*${STR}`);
      const args = re.exec(rest);
      if (!args) {
        problems.push(
          `${file}:${lineOf(src, at)}: ${fn}() needs a literal kind and a literal name`
        );
        continue;
      }
      found.push({
        name: args[4] ?? args[5] ?? args[6],
        kind: args[1] ?? args[2] ?? args[3],
        at,
      });
    } else {
      const re = new RegExp(`^\\s*${STR}`);
      const args = re.exec(rest);
      if (!args) {
        problems.push(`${file}:${lineOf(src, at)}: ${fn}() needs a literal name`);
        continue;
      }
      const kind = { trackView: 'view', trackShortcut: 'shortcut', trackError: 'error' }[fn];
      found.push({ name: pick(args), kind, at });
    }
  }

  for (const f of found) f.line = lineOf(src, f.at);
  // data-track with a template placeholder is not a literal name
  return {
    found: found.filter(f => {
      if (f.name.includes('${')) {
        problems.push(`${file}:${f.line}: data-track name is not a literal: ${f.name}`);
        return false;
      }
      return true;
    }),
    problems,
  };
}

function surfaceOf(name) {
  return SURFACE_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null;
}

/** Scan a repo tree; returns `{ entries, problems }` (entries sorted by name). */
export function scanRepo(root) {
  const problems = [];
  const byName = new Map();
  const files = [
    ...walk(path.join(root, DASHBOARD_DIR), n => /\.(html|js)$/.test(n)),
    ...walk(
      path.join(root, MODULE_DIR),
      n => /\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n) && !n.endsWith('.d.ts')
    ),
  ].sort();

  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (DEFINITION_FILES.has(rel)) continue;
    const fromModule = rel.startsWith(`${MODULE_DIR}/`);
    const { found, problems: fileProblems } = scanText(
      readFileSync(abs, 'utf8'),
      rel,
      rel.endsWith('.html')
    );
    problems.push(...fileProblems);
    for (const f of found) {
      const where = `${rel}:${f.line}`;
      if (!KINDS.includes(f.kind)) {
        problems.push(`${where}: unknown usage kind "${f.kind}" for ${f.name}`);
        continue;
      }
      if (f.name.length > NAME_MAX || !NAME_RE.test(f.name)) {
        problems.push(`${where}: "${f.name}" is not a valid control name`);
        continue;
      }
      const surface = surfaceOf(f.name);
      if (!surface || (fromModule ? surface !== 'module' : surface === 'module')) {
        problems.push(
          `${where}: "${f.name}" has the wrong prefix for ${fromModule ? 'the Foundry module' : 'the dashboard pages'}`
        );
        continue;
      }
      if ((f.kind === 'tool') !== f.name.startsWith('tool.')) {
        problems.push(
          `${where}: "${f.name}" must use kind "tool" exactly when it starts with "tool."`
        );
        continue;
      }
      if (!byName.has(f.name))
        byName.set(f.name, { name: f.name, kind: f.kind, surface, file: rel });
    }
  }
  const entries = [...byName.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  return { entries, problems };
}

const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The generated file's text (prettier-stable: single quotes, 100 columns). */
export function renderCatalog(entries) {
  const lines = [
    '// GENERATED by scripts/usage-catalog.mjs (npm run usage:catalog). Do not edit by hand.',
    "import type { UsageCatalogEntry } from './usage.js';",
    '',
  ];
  if (entries.length === 0) {
    lines.push('export const USAGE_CATALOG: readonly UsageCatalogEntry[] = [];');
  } else {
    lines.push('export const USAGE_CATALOG: readonly UsageCatalogEntry[] = [');
    for (const e of entries) {
      const one = `  { name: ${q(e.name)}, kind: ${q(e.kind)}, surface: ${q(e.surface)}, file: ${q(e.file)} },`;
      if (one.length <= 100) {
        lines.push(one);
      } else {
        lines.push(
          '  {',
          `    name: ${q(e.name)},`,
          `    kind: ${q(e.kind)},`,
          `    surface: ${q(e.surface)},`,
          `    file: ${q(e.file)},`,
          '  },'
        );
      }
    }
    lines.push('];');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1] ?? '') : defaultRoot;
  const { entries, problems } = scanRepo(root);
  if (problems.length > 0) {
    console.error('usage-catalog: cannot build the catalogue:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const text = renderCatalog(entries);
  const target = path.join(root, OUTPUT);
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
  if (check) {
    if (current !== text) {
      console.error(`usage-catalog: ${OUTPUT} is stale. Run: npm run usage:catalog`);
      process.exit(1);
    }
    console.log(`usage-catalog: ${entries.length} controls, up to date.`);
    return;
  }
  if (current === text) {
    console.log(`usage-catalog: ${entries.length} controls, unchanged.`);
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
  console.log(`usage-catalog: wrote ${entries.length} controls to ${OUTPUT}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
