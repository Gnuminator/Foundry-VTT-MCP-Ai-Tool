#!/usr/bin/env node
/**
 * Stage the wiki (D-097 decision 5): copy the GM and player guides into one MkDocs source tree,
 * so the site renders the same markdown as the dashboard help and the GM coach skill.
 *
 *   build/wiki/mkdocs.yml        docs/wiki/mkdocs.yml plus docs_dir, site_dir and a generated nav
 *   build/wiki/src/index.md      docs/wiki/index.md (the home page)
 *   build/wiki/src/gm/           docs/gm
 *   build/wiki/src/player/       docs/player
 *   build/wiki/src/images/       only the images the pages use, from docs/images
 *   build/wiki/src/assets/       the logo and favicon
 *   build/wiki/src/gm/downloads/foundry-gm-coach.zip   from `npm run gm-coach`
 *
 * Links: a link between the staged pages stays relative; a link to any other repo file becomes
 * a GitHub link, the same rule as the dashboard help. The nav follows each README: its pages in
 * the order the README links them, then any page it does not link, A to Z. A new guide page needs
 * no wiki change.
 *
 * Then: `python -m mkdocs build --strict -f build/wiki/mkdocs.yml` (the wiki workflow does both).
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
const outRoot = path.join(repo, 'build', 'wiki');
const src = path.join(outRoot, 'src');
const GITHUB = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool';

/** Repo folder (forward slashes) to its place in the staged tree. */
const SECTIONS = [
  { from: 'docs/gm', to: 'gm' },
  { from: 'docs/player', to: 'player' },
];
const HOME = 'docs/wiki/index.md';
const COACH_MARKER = '<!-- wiki:coach-download -->';
const COACH_LINE =
  'On the wiki you can download it here: [foundry-gm-coach.zip](downloads/foundry-gm-coach.zip).';

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

/**
 * Rewrite the relative links of one page. Links inside code fences stay as they are.
 * @param {string} text the page
 * @param {string} repoPath where the page lives in the repo (forward slashes)
 * @param {Set<string>} images collects the repo paths of the images the page uses
 */
export function rewriteLinks(text, repoPath, images) {
  const staged = stagedPathOf(repoPath);
  let fence = null;
  return text
    .split('\n')
    .map(line => {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (fence === null) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      if (fence !== null) return line;
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

/** The .md pages of a section in nav order: as its README links them, then the rest A to Z. */
export function navOrder(readme, files) {
  const linked = [];
  for (const m of readme.matchAll(/\]\(([a-z0-9-]+\.md)(?:#[^)]*)?\)/gi)) {
    if (files.includes(m[1]) && !linked.includes(m[1]) && m[1] !== 'README.md') linked.push(m[1]);
  }
  const rest = files.filter(f => f !== 'README.md' && !linked.includes(f)).sort();
  return ['README.md', ...linked, ...rest];
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
  const out = path.join(src, stagedPathOf(repoPath));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, staged);
}

function main() {
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const images = new Set();
  const nav = ['  - Home: index.md'];

  stagePage(HOME, images);
  for (const s of SECTIONS) {
    const files = readdirSync(path.join(repo, s.from)).filter(f => f.endsWith('.md'));
    for (const f of files) stagePage(`${s.from}/${f}`, images);
    const readme = readFileSync(path.join(repo, s.from, 'README.md'), 'utf8');
    const title = /^title:\s*(.+)$/m.exec(readme)?.[1].trim() ?? s.to;
    nav.push(`  - ${title}:`);
    for (const f of navOrder(readme, files)) nav.push(`      - ${s.to}/${f}`);
  }

  for (const img of images) {
    const out = path.join(src, stagedPathOf(img));
    mkdirSync(path.dirname(out), { recursive: true });
    copyFileSync(path.join(repo, img), out);
  }
  mkdirSync(path.join(src, 'assets'), { recursive: true });
  copyFileSync(path.join(repo, 'docs/images/brand/logo.svg'), path.join(src, 'assets', 'logo.svg'));
  copyFileSync(
    path.join(repo, 'docs/images/brand/favicon-32.png'),
    path.join(src, 'assets', 'favicon.png')
  );

  const coach = buildCoach(path.join(outRoot, 'coach'));
  mkdirSync(path.join(src, 'gm', 'downloads'), { recursive: true });
  copyFileSync(coach.zipFile, path.join(src, 'gm', 'downloads', 'foundry-gm-coach.zip'));

  const base = readFileSync(path.join(repo, 'docs/wiki/mkdocs.yml'), 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(
    path.join(outRoot, 'mkdocs.yml'),
    `${base.trimEnd()}\n\n# Added by scripts/wiki/stage.mjs\ndocs_dir: src\nsite_dir: site\nnav:\n${nav.join('\n')}\n`
  );
  console.log(
    `wiki: staged ${toPosix(path.relative(repo, src))} (${images.size} image(s)); build with`
  );
  console.log('  python -m mkdocs build --strict -f build/wiki/mkdocs.yml');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
