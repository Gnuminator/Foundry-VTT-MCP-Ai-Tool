#!/usr/bin/env node
/**
 * Stage the wiki (D-097 decision 5): copy the GM, player and Foundry basics guides into the
 * Starlight project in docs/wiki, so the site renders the same markdown as the dashboard help and
 * the GM coach skill. Everything it writes is gitignored.
 *
 *   docs/wiki/src/content/docs/index.md            docs/wiki/index.md (the home page)
 *   docs/wiki/src/content/docs/{gm,player,foundry}/ the guides; each README.md becomes index.md
 *   docs/wiki/public/images/                       only the images and clips the pages use
 *   docs/wiki/public/gm/downloads/foundry-gm-coach.zip   from `npm run gm-coach`
 *   docs/wiki/src/assets/logo.svg, public/favicon.png    the brand
 *   docs/wiki/src/sidebar.generated.json           the grouped sidebar
 *
 * Links: a link between the staged pages becomes the page's site URL (Starlight does not resolve
 * .md links); a link to any other repo file becomes a GitHub link, the same rule as the dashboard
 * help. The first `# H1` of a page is dropped (Starlight prints the title). The sidebar groups
 * follow SIDEBAR below; a page not named there falls into a last group, so a new guide page needs
 * no wiki change.
 *
 * Then: `npm ci --prefix docs/wiki && npm run build --prefix docs/wiki` builds build/wiki/site
 * (the wiki workflow does all three).
 *
 *   node scripts/wiki/stage.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildCoach } from '../../tools/gm-coach/build.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wikiDir = path.join(repo, 'docs', 'wiki');
const docsOut = path.join(wikiDir, 'src', 'content', 'docs');
const publicOut = path.join(wikiDir, 'public');
const buildRoot = path.join(repo, 'build', 'wiki');
const GITHUB = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool';
/** The Pages base path; keep equal to `base` in docs/wiki/astro.config.mjs. */
export const BASE = '/Foundry-VTT-MCP-Ai-Tool';

/** Repo folder (forward slashes) to its place in the staged tree. */
const SECTIONS = [
  { from: 'docs/gm', to: 'gm' },
  { from: 'docs/player', to: 'player' },
  { from: 'docs/foundry', to: 'foundry' },
];
const HOME = 'docs/wiki/index.md';
const COACH_MARKER = '<!-- wiki:coach-download -->';
const COACH_LINE =
  'On the wiki you can download it here: [foundry-gm-coach.zip](downloads/foundry-gm-coach.zip).';

/** Sidebar groups (board A, 2026-10-29): label and page slugs, in order. */
const SIDEBAR = [
  {
    label: 'Start here',
    pages: ['gm', 'gm/first-hour', 'gm/getting-started', 'gm/connect-claude-desktop', 'gm/claude-plans'],
  },
  {
    label: 'Game night',
    pages: ['gm/before-session', 'gm/game-night-runbook', 'gm/after-session', 'gm/tv-table-viewer'],
  },
  {
    label: 'The tool',
    pages: [
      'gm/dashboard',
      'gm/gm-windows',
      'gm/features',
      'gm/asking-claude',
      'gm/gm-coach',
      'gm/cookbook',
      'gm/obsidian',
    ],
  },
  {
    label: 'Your campaign',
    pages: ['gm/prep-and-expectations', 'gm/prepare-session-0', 'gm/death-and-new-characters'],
  },
  { label: 'When it breaks', pages: ['gm/troubleshooting', 'gm/never-and-only-if'] },
  { label: 'For players', pages: ['player'], rest: 'player' },
  { label: 'Foundry basics', pages: ['foundry'], rest: 'foundry' },
];
const LAST_GROUP = 'More guides';

/** Repo-relative path (forward slashes) of a staged page's source, mapped into the staged tree. */
function stagedPathOf(repoPath) {
  if (repoPath === HOME) return 'index.md';
  for (const s of SECTIONS) {
    if (repoPath.startsWith(`${s.from}/`)) return `${s.to}/${repoPath.slice(s.from.length + 1)}`;
  }
  if (repoPath.startsWith('docs/images/')) return `images/${repoPath.slice('docs/images/'.length)}`;
  return null;
}

const toPosix = p => p.split(path.sep).join('/');

/** Returns a function: true for the lines that open, close or sit inside a fenced code block. */
function fenceTracker() {
  let fence = null;
  return line => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return true;
    }
    return fence !== null;
  };
}

/**
 * Rewrite the relative links of one page. Links inside code fences stay as they are.
 * @param {string} text the page
 * @param {string} repoPath where the page lives in the repo (forward slashes)
 * @param {Set<string>} images collects the repo paths of the images the page uses
 */
export function rewriteLinks(text, repoPath, images) {
  const staged = stagedPathOf(repoPath);
  const inCode = fenceTracker();
  return text
    .split('\n')
    .map(line => {
      if (inCode(line)) return line;
      return line.replace(/(!?)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (match, bang, target, title) => {
        if (
          /^[a-z][a-z0-9+.-]*:/i.test(target) ||
          target.startsWith('#') ||
          target.startsWith('/')
        ) {
          return match;
        }
        const hash = target.indexOf('#');
        const file = hash === -1 ? target : target.slice(0, hash);
        const anchor = hash === -1 ? '' : target.slice(hash);
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(repoPath), file));
        const to = stagedPathOf(resolved);
        if (to !== null && existsSync(path.join(repo, resolved))) {
          if (to.startsWith('images/')) images.add(resolved);
          const rel =
            path.posix.relative(path.posix.dirname(staged), to) || path.posix.basename(to);
          return `${bang}](${rel}${anchor}${title})`;
        }
        const isDir =
          existsSync(path.join(repo, resolved)) &&
          statSync(path.join(repo, resolved)).isDirectory();
        return `${bang}](${GITHUB}/${isDir ? 'tree' : 'blob'}/main/${resolved}${anchor}${title})`;
      });
    })
    .join('\n');
}

/** Site URL (with the base) of a staged page, e.g. `gm/first-hour.md` to `/base/gm/first-hour/`. */
export function pageUrl(stagedPath) {
  const slug = stagedPath
    .replace(/\.md$/, '')
    .replace(/(^|\/)(README|index)$/, '')
    .replace(/\/$/, '');
  return slug === '' ? `${BASE}/` : `${BASE}/${slug}/`;
}

/** The GitHub-style anchor of a heading (what the dashboard help and the old wiki used). */
const slugOf = heading =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const escapeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * Turn the staged-relative links of a page into site URLs, show a clip written as an image as a
 * <video>, and drop the first H1. Links inside code fences stay as they are.
 * @param {string} text a page after rewriteLinks
 * @param {string} stagedPath the page's place in the staged tree (e.g. `gm/first-hour.md`)
 */
export function toSite(text, stagedPath) {
  const inCode = fenceTracker();
  const dir = path.posix.dirname(stagedPath);
  let dropped = false;
  let inFront = text.startsWith('---\n');
  return text
    .split('\n')
    .map((line, i) => {
      if (inFront) {
        if (i > 0 && line === '---') inFront = false;
        return line;
      }
      if (inCode(line)) return line;
      if (!dropped && /^# /.test(line)) {
        dropped = true;
        // Starlight prints the title itself; the empty anchor keeps `page/#the-title` links alive.
        return `<a id="${slugOf(line.slice(2))}"></a>`;
      }
      const siteUrl = target => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return null;
        const hash = target.indexOf('#');
        const file = hash === -1 ? target : target.slice(0, hash);
        if (file === '') return null;
        const staged = path.posix.normalize(path.posix.join(dir, file));
        return /\.md$/.test(staged)
          ? pageUrl(staged) + (hash === -1 ? '' : target.slice(hash))
          : `${BASE}/${staged}`;
      };
      // A clip written as an image becomes a <video>.
      const withClips = line.replace(/!\[([^\]]*)\]\(([^)\s]+\.(?:mp4|webm))\)/gi, (m, label, target) => {
        const url = siteUrl(target);
        return url === null
          ? m
          : `<video src="${url}" controls muted loop playsinline preload="metadata" aria-label="${escapeAttr(label)}"></video>`;
      });
      // A link's text can wrap onto the line before, so only the `](target)` part is matched.
      return withClips.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (m, target, title) => {
        const url = siteUrl(target);
        return url === null ? m : `](${url}${title})`;
      });
    })
    .filter(l => l !== null)
    .join('\n');
}

/** The .md pages of a section in nav order: as its README links them, then the rest A to Z. */
export function navOrder(readme, files) {
  const linked = [];
  for (const m of readme.matchAll(/\]\(([a-z0-9-]+\.md)(?:#[^)]*)?\)/gi)) {
    if (files.includes(m[1]) && !linked.includes(m[1]) && m[1] !== 'README.md') linked.push(m[1]);
  }
  const rest = files.filter(f => f !== 'README.md' && !linked.includes(f)).sort();
  return ['README.md', ...linked, ...rest];
}

/**
 * The grouped sidebar for Starlight. Pages named in SIDEBAR go where it puts them; a group with a
 * `rest` section also takes every page of that section it does not name (README order, then
 * A to Z); any other staged page falls into the last group.
 * @param {string[]} slugs every staged page slug (`gm`, `gm/first-hour`, ...)
 * @param {Record<string, string[]>} order the nav order of each section's slugs
 */
export function buildSidebar(slugs, order) {
  const placed = new Set();
  const groups = SIDEBAR.map(g => {
    const items = [];
    for (const slug of g.pages) {
      if (slugs.includes(slug)) {
        items.push(slug);
        placed.add(slug);
      }
    }
    if (g.rest) {
      for (const slug of order[g.rest] ?? []) {
        if (!placed.has(slug)) {
          items.push(slug);
          placed.add(slug);
        }
      }
    }
    return { label: g.label, items };
  }).filter(g => g.items.length > 0);
  const left = slugs.filter(s => s !== 'index' && !placed.has(s));
  if (left.length > 0) groups.push({ label: LAST_GROUP, items: left.sort() });
  const labels = { gm: 'GM guides overview', player: 'Player guide', foundry: 'Foundry basics overview' };
  const asItem = slug => ({ slug, ...(labels[slug] ? { label: labels[slug] } : {}) });
  return [
    { slug: 'index', label: 'Home' },
    ...groups.map(g => ({ label: g.label, items: g.items.map(asItem) })),
  ];
}

function stagePage(repoPath, images) {
  const text = readFileSync(path.join(repo, repoPath), 'utf8').replace(/\r\n/g, '\n');
  let staged = rewriteLinks(text, repoPath, images);
  // The download link goes in after the rewrite: the zip exists only in the staged tree.
  if (repoPath === 'docs/gm/gm-coach.md') {
    if (!staged.includes(COACH_MARKER))
      throw new Error(`docs/gm/gm-coach.md lost its ${COACH_MARKER} line`);
    staged = staged.replace(COACH_MARKER, COACH_LINE);
  }
  const rel = stagedPathOf(repoPath);
  const outRel = rel.replace(/(^|\/)README\.md$/, '$1index.md');
  const out = path.join(docsOut, outRel);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, toSite(staged, rel));
  return outRel.replace(/\.md$/, '').replace(/\/index$/, '');
}

function main() {
  rmSync(docsOut, { recursive: true, force: true });
  rmSync(publicOut, { recursive: true, force: true });
  rmSync(path.join(wikiDir, 'src', 'assets'), { recursive: true, force: true });
  mkdirSync(docsOut, { recursive: true });
  const images = new Set();
  const slugs = [];
  /** @type {Record<string, string[]>} */
  const order = {};

  slugs.push(stagePage(HOME, images));
  for (const s of SECTIONS) {
    if (!existsSync(path.join(repo, s.from))) continue;
    const files = readdirSync(path.join(repo, s.from)).filter(f => f.endsWith('.md'));
    slugs.push(...files.map(f => stagePage(`${s.from}/${f}`, images)));
    const readme = readFileSync(path.join(repo, s.from, 'README.md'), 'utf8');
    order[s.to] = navOrder(readme, files).map(f =>
      f === 'README.md' ? s.to : `${s.to}/${f.replace(/\.md$/, '')}`
    );
  }

  for (const img of images) {
    const out = path.join(publicOut, stagedPathOf(img));
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(path.join(repo, img), out);
  }
  mkdirSync(path.join(wikiDir, 'src', 'assets'), { recursive: true });
  copyFileSync(
    path.join(repo, 'docs/images/brand/logo.svg'),
    path.join(wikiDir, 'src', 'assets', 'logo.svg')
  );
  copyFileSync(
    path.join(repo, 'docs/images/brand/favicon-32.png'),
    path.join(publicOut, 'favicon.png')
  );

  const coach = buildCoach(path.join(buildRoot, 'coach'));
  mkdirSync(path.join(publicOut, 'gm', 'downloads'), { recursive: true });
  copyFileSync(coach.zipFile, path.join(publicOut, 'gm', 'downloads', 'foundry-gm-coach.zip'));

  writeFileSync(
    path.join(wikiDir, 'src', 'sidebar.generated.json'),
    `${JSON.stringify(buildSidebar(slugs, order), null, 2)}\n`
  );
  console.log(
    `wiki: staged ${toPosix(path.relative(repo, docsOut))} (${slugs.length} page(s), ${images.size} image(s)); build with`
  );
  console.log('  npm ci --prefix docs/wiki && npm run build --prefix docs/wiki');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
