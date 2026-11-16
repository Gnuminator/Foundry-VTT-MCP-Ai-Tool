#!/usr/bin/env node
/**
 * Check the built wiki keeps the player side free of GM pages: no page under player/ (or da/player/)
 * may link to a GM page or to the GM-side Foundry basics (sidebar, previous/next and body links
 * alike). Search is not covered: it is site-wide.
 *
 *   node scripts/wiki/check-sides.mjs [site dir]    default build/wiki/site
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = '/Foundry-VTT-MCP-Ai-Tool';

/** The hrefs in `html` that lead to a GM page (gm/, foundry/, with or without a language prefix). */
export function gmLinks(html) {
  const bad = [];
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const rest = m[1].startsWith(`${BASE}/`) ? m[1].slice(BASE.length) : null;
    if (rest !== null && /^\/(da\/)?(gm|foundry)(\/|$)/.test(rest)) bad.push(m[1]);
  }
  return bad;
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith('.html') ? [full] : [];
  });
}

function main() {
  const site = path.resolve(process.argv[2] ?? path.join(repo, 'build', 'wiki', 'site'));
  const roots = ['player', path.join('da', 'player')].map(p => path.join(site, p));
  let pages = 0;
  const problems = [];
  for (const root of roots) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of htmlFiles(root)) {
      pages++;
      for (const href of gmLinks(readFileSync(file, 'utf8'))) {
        problems.push(`${path.relative(site, file)} links to ${href}`);
      }
    }
  }
  if (pages === 0) {
    console.error(`wiki:sides: no player pages found under ${site}`);
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error(`wiki:sides: the player side links to GM pages:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`wiki:sides: OK, ${pages} player page(s) link only to player pages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
