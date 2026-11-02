#!/usr/bin/env node
/**
 * Danish twins of the GM and player guides (format: docs/README.md, "Danish twins").
 *
 * Every page in docs/gm and docs/player has a twin at docs/da/<section>/<name>.md whose front matter
 * says which English page it translates (`source: gm/first-hour.md`, relative to docs/) and the hash
 * of that page when the translation was made (`sourceHash`: the first 12 hex characters of the
 * SHA-256 of the English file with line endings turned into LF).
 *
 *   node scripts/wiki/da.mjs check            fail on a missing twin, a stale twin or an em dash
 *   node scripts/wiki/da.mjs hash <page>...   print the hash of English pages (gm/x.md or docs/gm/x.md)
 *   node scripts/wiki/da.mjs stamp <page>...  write the current hash into the twins of those pages
 *
 * `stamp` says "the twin matches the English page as it is now": run it only after translating the
 * change, never to silence the check.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const docs = path.join(repo, 'docs');
export const SECTIONS = ['gm', 'player'];
const EM_DASH = String.fromCharCode(0x2014);

/** Hash of an English page: SHA-256 of the text with CRLF turned into LF, first 12 hex characters. */
export function hashOf(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

/** The front matter of a page as flat key/value strings (quotes around a value are dropped). */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

/** Every English guide page as `gm/first-hour.md`, sorted. */
export function englishPages(root = docs) {
  return SECTIONS.flatMap(s =>
    existsSync(path.join(root, s))
      ? readdirSync(path.join(root, s))
          .filter(f => f.endsWith('.md'))
          .map(f => `${s}/${f}`)
      : []
  ).sort();
}

export const twinOf = page => `da/${page}`;

/**
 * Problems of the Danish twins under `root` (the docs folder), one string each.
 * @param {string} [root]
 */
export function checkTwins(root = docs) {
  const problems = [];
  const pages = englishPages(root);
  for (const page of pages) {
    const twinPath = path.join(root, twinOf(page));
    if (!existsSync(twinPath)) {
      problems.push(`docs/${page} has no Danish twin (docs/${twinOf(page)})`);
      continue;
    }
    const twin = readFileSync(twinPath, 'utf8');
    const fm = frontMatter(twin);
    const want = hashOf(readFileSync(path.join(root, page), 'utf8'));
    if (fm.source !== page) {
      problems.push(`docs/${twinOf(page)}: front matter source must be "${page}"`);
    }
    if (!fm.title || !fm.description) {
      problems.push(`docs/${twinOf(page)}: front matter needs a title and a description`);
    }
    if (!fm.sourceHash) {
      problems.push(`docs/${twinOf(page)}: front matter has no sourceHash (should be ${want})`);
    } else if (fm.sourceHash !== want) {
      problems.push(
        `docs/${twinOf(page)} is older than docs/${page}: translate the change, then ` +
          `\`node scripts/wiki/da.mjs stamp ${page}\` (hash ${fm.sourceHash}, now ${want})`
      );
    }
    // YAML: a plain value with ": " or " #" breaks the front matter, the build says so only later.
    const raw = /^---\r?\n([\s\S]*?)\r?\n---/.exec(twin)?.[1] ?? '';
    for (const line of raw.split(/\r?\n/)) {
      const kv = /^(title|description): +(?!['"])(.*)$/.exec(line);
      if (kv && /(: | #)/.test(kv[2])) {
        problems.push(
          `docs/${twinOf(page)}: front matter ${kv[1]} needs quotes (it has ": " or " #")`
        );
      }
    }
    if (twin.includes(EM_DASH)) {
      problems.push(`docs/${twinOf(page)} has an em dash (public docs voice: none)`);
    }
  }
  // A twin whose English page is gone.
  for (const s of SECTIONS) {
    const dir = path.join(root, 'da', s);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(n => n.endsWith('.md'))) {
      if (!pages.includes(`${s}/${f}`)) problems.push(`docs/da/${s}/${f} has no English page`);
    }
  }
  return problems;
}

/** `gm/x.md` or `docs/gm/x.md` to `gm/x.md`. */
const pageArg = arg => arg.replace(/\\/g, '/').replace(/^docs\//, '');

/** Write the current hash of each page into its twin's front matter. Returns the pages stamped. */
export function stamp(pages, root = docs) {
  for (const page of pages) {
    const twinPath = path.join(root, twinOf(page));
    const hash = hashOf(readFileSync(path.join(root, page), 'utf8'));
    let twin = readFileSync(twinPath, 'utf8');
    const eol = twin.includes('\r\n') ? '\r\n' : '\n';
    if (/^sourceHash:.*$/m.test(twin)) {
      twin = twin.replace(/^sourceHash:.*$/m, `sourceHash: ${hash}`);
    } else if (/^source:.*$/m.test(twin)) {
      twin = twin.replace(/^(source:.*)$/m, `$1${eol}sourceHash: ${hash}`);
    } else {
      twin = twin.replace(/^---\r?\n/, `---${eol}source: ${page}${eol}sourceHash: ${hash}${eol}`);
    }
    writeFileSync(twinPath, twin);
  }
  return pages;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'check') {
    const problems = checkTwins();
    if (problems.length > 0) {
      console.error(`wiki:da: ${problems.length} problem(s) with the Danish twins:`);
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(`wiki:da: OK, ${englishPages().length} guide(s) with a current Danish twin`);
  } else if (cmd === 'hash' && args.length > 0) {
    for (const a of args) {
      console.log(`${hashOf(readFileSync(path.join(docs, pageArg(a)), 'utf8'))}  ${pageArg(a)}`);
    }
  } else if (cmd === 'stamp' && args.length > 0) {
    console.log(`wiki:da: stamped ${stamp(args.map(pageArg)).join(', ')}`);
  } else {
    console.error('usage: node scripts/wiki/da.mjs check | hash <page>... | stamp <page>...');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
