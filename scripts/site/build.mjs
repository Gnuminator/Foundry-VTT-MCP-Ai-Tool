#!/usr/bin/env node
/**
 * Build the showcase site (backlog showcase-site, D-129): copy site/ into the Pages tree and check it.
 *
 *   node scripts/site/build.mjs                       overlay onto the built wiki (build/wiki/site)
 *   node scripts/site/build.mjs --out <dir> --standalone   only the showcase, for a local preview
 *
 * The showcase is the front door at the Pages root; the wiki (guides, player pages, Danish pages) is
 * built beside it and keeps its own URLs, so nothing that links to a guide page moves. The landing
 * page replaces the wiki's own home page, which only asked "player or GM?"; the showcase links to
 * /gm/ and /player/ for that.
 *
 * Checks (a failure exits 1):
 *  - every relative href and src in site/index.html points at a file in the output (links into the
 *    wiki are checked too unless --standalone);
 *  - site/ holds no campaign or book words (the public repo keeps none, D-065);
 *  - the page loads nothing from another host (no fonts, scripts or trackers).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const siteDir = path.join(repo, 'site');

/** Images the page uses, copied from docs/images so the repo holds no duplicates. */
export const IMAGES = [
  ['docs/images/brand/logo.svg', 'logo.svg'],
  ['docs/images/brand/favicon-32.png', 'favicon-32.png'],
  ['docs/images/cogm/overview.png', 'overview.png'],
  ['docs/images/cogm/before.png', 'before.png'],
  ['docs/images/cogm/combat-control.png', 'combat-control.png'],
  ['docs/images/cogm/tool-runner.png', 'tool-runner.png'],
  ['docs/images/cogm/confirm.png', 'confirm.png'],
];

/** Words that must never appear on the public site. */
export const BANNED = [
  'strahd',
  'barovia',
  'ravenloft',
  'vallaki',
  'rahadin',
  'madam eva',
  'tarokka',
  'danni',
  'cloudflare',
  'orange pi',
  'tailscale',
  '.ts.net',
  'trycloudflare',
  'curse of',
  'death house',
];

/** Hosts the page may link to (links only; nothing is loaded from them). */
const LINK_HOSTS = new Set(['github.com', 'gnuminator.github.io']);
// Adam Dooley's upstream project is credited on the page, so github.com covers it.

/** Wiki paths the landing page links to; checked against the wiki build when it exists. */
const WIKI_PREFIXES = ['gm/', 'player/', 'da/', 'foundry/'];

/** Added to the site by a step that may fail without stopping the wiki (Storybook), so never required. */
const OPTIONAL_PREFIXES = ['storybook/'];

export function findBanned(text) {
  const low = text.toLowerCase();
  return BANNED.filter(w => low.includes(w));
}

export function linkTargets(html) {
  const out = [];
  const re = /\s(href|src)=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(html))) out.push({ attr: m[1], url: m[2] });
  return out;
}

/** Problems with the landing page's links. `exists(relPath)` says whether the output holds a file. */
export function checkLinks(html, exists, { standalone = false } = {}) {
  const problems = [];
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const { attr, url } of linkTargets(html)) {
    if (url.startsWith('/')) {
      problems.push(`${attr} must be relative, not root-absolute: ${url}`);
    } else if (url.startsWith('#')) {
      if (url !== '#' && !ids.has(url.slice(1))) problems.push(`missing anchor ${url}`);
    } else if (/^https?:\/\//.test(url)) {
      const host = new URL(url).hostname;
      if (attr === 'src') problems.push(`src loads from another host: ${url}`);
      else if (!LINK_HOSTS.has(host)) problems.push(`href points at an unlisted host: ${url}`);
    } else if (/^(mailto:|data:|javascript:)/.test(url)) {
      problems.push(`${attr} uses a scheme the site does not allow: ${url}`);
    } else {
      const rel = url.split('#')[0].split('?')[0];
      if (!rel) continue;
      if (OPTIONAL_PREFIXES.some(p => rel.startsWith(p))) continue;
      const isWiki = WIKI_PREFIXES.some(p => rel.startsWith(p));
      if (isWiki && standalone) continue;
      const target = rel.endsWith('/') ? `${rel}index.html` : rel;
      if (!exists(target)) problems.push(`${attr} points at a missing file: ${url}`);
    }
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function main() {
  const standalone = process.argv.includes('--standalone');
  const out = path.resolve(repo, arg('--out') ?? 'build/wiki/site');
  if (!standalone && !existsSync(path.join(out, 'index.html'))) {
    console.error(
      `site: ${out} has no built wiki. Run the wiki build first, or pass --standalone.`
    );
    process.exit(1);
  }
  const problems = [];

  for (const f of walk(siteDir)) {
    if (!/\.(html|css|js|md)$/.test(f)) continue;
    const hits = findBanned(readFileSync(f, 'utf8'));
    if (hits.length) problems.push(`${path.relative(repo, f)} contains: ${hits.join(', ')}`);
  }

  mkdirSync(path.join(out, 'showcase', 'img'), { recursive: true });
  copyFileSync(path.join(siteDir, 'index.html'), path.join(out, 'index.html'));
  copyFileSync(path.join(siteDir, 'style.css'), path.join(out, 'showcase', 'style.css'));
  for (const [from, to] of IMAGES) {
    copyFileSync(path.join(repo, from), path.join(out, 'showcase', 'img', to));
  }

  const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  problems.push(...checkLinks(html, rel => existsSync(path.join(out, rel)), { standalone }));
  const css = readFileSync(path.join(siteDir, 'style.css'), 'utf8');
  if (/url\(|@import|https?:\/\//.test(css)) problems.push('style.css loads something by URL');

  if (problems.length) {
    for (const p of problems) console.error(`site: ${p}`);
    process.exit(1);
  }
  console.log(`site: ok, written to ${path.relative(repo, out) || '.'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
