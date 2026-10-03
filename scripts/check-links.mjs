#!/usr/bin/env node
/**
 * Internal link check for the docs (I-081): every relative link in a tracked
 * Markdown file must point at a file or folder that exists, and every
 * `#anchor` at a heading (or an `id`/`name` anchor) in its target page.
 * External links (http, https, mailto) are not fetched here; the weekly
 * `docs-links` workflow checks those.
 *
 * Scope: tracked `*.md` files (`git ls-files`), without `docs/history/**`
 * (history is never rewritten) and `.claude/**` (Claude's own skills).
 * Links inside code blocks and code spans are skipped.
 *
 *   node scripts/check-links.mjs           check, exit 1 on a broken link
 *   node scripts/check-links.mjs --root d  check another tree (tests)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootArg = process.argv.indexOf('--root');
const repoRoot =
  rootArg > -1
    ? path.resolve(process.argv[rootArg + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXCLUDED_PREFIXES = ['docs/history/', '.claude/'];

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images keep their text
    .replace(/<[^>]+>/g, '') // inline HTML tags
    .replace(/[`*_~]/g, match => (match === '_' ? '_' : '')) // code and emphasis marks
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/ /g, '-');
}

/** Lines with code blocks blanked and code spans removed, so their contents are not links. */
export function proseLines(text) {
  let fence = null;
  return text.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker[1];
      return '';
    }
    return line.replace(/(`+)[^`]*?\1/g, '');
  });
}

/** Every anchor a page offers: headings (with GitHub's -1, -2 for repeats) and HTML ids. */
export function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  let inFrontMatter = text.startsWith('---\n') || text.startsWith('---\r\n');
  let fence = null;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (inFrontMatter) {
      if (index > 0 && line === '---') inFrontMatter = false;
      continue;
    }
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slugify(heading[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of line.matchAll(/<[a-z]+[^>]*\s(?:id|name)="([^"]+)"/gi)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

/** Link targets in a page: inline links and images, and reference definitions. */
export function linksOf(text) {
  const links = [];
  for (const [index, line] of proseLines(text).entries()) {
    for (const match of line.matchAll(
      /!?\[(?:[^\]]|\][^(])*?\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
    )) {
      links.push({ line: index + 1, target: match[1] });
    }
    const definition = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/.exec(line);
    if (definition) links.push({ line: index + 1, target: definition[1] });
  }
  return links;
}

function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function trackedMarkdown() {
  return execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter(file => !EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix)));
}

function main() {
  const anchorCache = new Map();
  const anchorsFor = file => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };
  const problems = [];
  const files = trackedMarkdown();
  let checked = 0;
  for (const file of files) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) continue; // deleted in the working tree
    for (const { line, target } of linksOf(readFileSync(full, 'utf8'))) {
      if (isExternal(target)) continue;
      checked++;
      const hashAt = target.indexOf('#');
      const rawPath = hashAt === -1 ? target : target.slice(0, hashAt);
      const anchor = hashAt === -1 ? '' : target.slice(hashAt + 1);
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(rawPath.split('?')[0]);
      } catch {
        problems.push(`${file}:${line}: cannot decode link ${target}`);
        continue;
      }
      const resolved =
        decodedPath === ''
          ? full
          : decodedPath.startsWith('/')
            ? path.join(repoRoot, decodedPath)
            : path.resolve(path.dirname(full), decodedPath);
      if (!existsSync(resolved)) {
        problems.push(`${file}:${line}: ${target} (no such file)`);
        continue;
      }
      if (anchor && resolved.endsWith('.md') && statSync(resolved).isFile()) {
        const wanted = decodeURIComponent(anchor).toLowerCase();
        if (!anchorsFor(resolved).has(wanted)) {
          problems.push(`${file}:${line}: ${target} (no heading or anchor "#${anchor}")`);
        }
      }
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(
      `check-links: ${problems.length} broken internal link(s) in ${files.length} files.`
    );
    process.exit(1);
  }
  console.log(`check-links: OK, ${checked} internal links in ${files.length} files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
