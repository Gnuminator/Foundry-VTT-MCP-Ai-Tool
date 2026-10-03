#!/usr/bin/env node
/**
 * Build the dashboard's in-app help (I-064): render the GM guide pages (docs/gm/*.md) into one
 * JSON file, dist/help.json, that the dashboard serves at GET /api/help/:page. Rendered at build
 * time, so nothing reads the docs at request time, the help matches the version it was built
 * with, and the Docker image and the Windows install need no copy of the docs.
 *
 * Links: another guide page (`dashboard.md#ready-for-session`) opens in the help panel
 * (`data-help`), a link to any other repo file opens on GitHub in a new tab, web links open in a
 * new tab. A link to a guide page that does not exist, or to a missing anchor in one, fails the
 * build (links to the rest of the repo are checked by `npm run docs:links`). Images are left out
 * (their alt text stays).
 *
 * `--soft` (the dev script behind `npm run dev:cogm`): any problem is only a warning and the exit
 * code is 0, so the dashboard still starts; its help panel then says the help is not built.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const soft = process.argv.includes('--soft');

/** Report a problem: fail the build, or only warn in soft mode. */
function fail(message) {
  console.error(`build-help: ${message}`);
  process.exit(soft ? 0 : 1);
}

let Marked;
let anchorsOf;
let slugify;
try {
  ({ Marked } = await import('marked'));
  ({ anchorsOf, slugify } = await import('../../../scripts/check-links.mjs'));
} catch (error) {
  fail(`cannot render the help (${error instanceof Error ? error.message : String(error)})`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const guideDir = path.join(repo, 'docs', 'gm');
const outFile = path.join(here, '..', 'dist', 'help.json');
const GITHUB = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/blob/main';

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Front matter (`title:` only) and the body. */
function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { title: null, body: text };
  const title = /^title:\s*(.+)$/m.exec(m[1]);
  return {
    title: title ? title[1].trim().replace(/^["']|["']$/g, '') : null,
    body: text.slice(m[0].length),
  };
}

const pages = readdirSync(guideDir)
  .filter(f => f.endsWith('.md'))
  .map(f => f.slice(0, -3))
  .sort();
const sources = new Map(pages.map(p => [p, readFileSync(path.join(guideDir, `${p}.md`), 'utf8')]));
const anchors = new Map(pages.map(p => [p, anchorsOf(sources.get(p))]));
const problems = [];

/** Where a link in `page` points: an in-help link, GitHub, or the web. */
function resolveLink(page, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { external: href };
  const [target, anchor = ''] = href.split('#');
  if (!target) {
    if (anchor && !anchors.get(page).has(anchor))
      problems.push(`${page}.md: missing anchor #${anchor}`);
    return { help: `${page}#${anchor}` };
  }
  const file = path.resolve(guideDir, target);
  const rel = path.relative(guideDir, file).replace(/\\/g, '/');
  // A link to another repo file becomes a GitHub link. Only links between guide pages are
  // checked here: the rest of the repo may be missing (the Docker build stage has only
  // docs/gm), and `npm run docs:links` checks every link in CI.
  if (!rel.includes('/') && !rel.startsWith('..') && !existsSync(file)) {
    problems.push(`${page}.md: broken link ${href}`);
    return { external: href };
  }
  const name = rel.endsWith('.md') && !rel.includes('/') ? rel.slice(0, -3) : null;
  if (name && pages.includes(name)) {
    if (anchor && !anchors.get(name).has(anchor))
      problems.push(`${page}.md: missing anchor ${href}`);
    return { help: `${name}#${anchor}` };
  }
  const repoPath = path.relative(repo, file).replace(/\\/g, '/');
  return { external: `${GITHUB}/${repoPath}${anchor ? `#${anchor}` : ''}` };
}

function render(page, body) {
  const seen = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const base = slugify(text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${depth} id="${escapeAttr(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const to = resolveLink(page, href);
        if (to.help !== undefined) {
          return `<a href="#" data-help="${escapeAttr(to.help)}">${inner}</a>`;
        }
        return `<a href="${escapeAttr(to.external)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image({ text }) {
        return text ? `<em>${escapeAttr(text)}</em>` : '';
      },
      html() {
        return '';
      },
    },
  });
  return marked.parse(body);
}

const out = { pages: {} };
for (const page of pages) {
  const { title, body } = splitFrontMatter(sources.get(page));
  const h1 = /^#\s+(.+)$/m.exec(body);
  out.pages[page] = { title: title ?? (h1 ? h1[1].trim() : page), html: render(page, body) };
}

if (problems.length > 0) fail(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(out)}\n`, 'utf8');
console.log(`build-help: wrote ${pages.length} pages to ${path.relative(repo, outFile)}`);
