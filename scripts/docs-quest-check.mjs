#!/usr/bin/env node
/**
 * The three quest pages (docs/gm/*-quest.md) are checklists to tick off. They must not carry a
 * second copy of the steps on the checklist page they were made from; they link to the steps.
 * Two things fail:
 *
 *   copy      a run of COPY_WORDS words in a quest page that also stands, word for word, on its
 *             checklist page (the quest should link to the step and say it in its own, shorter way)
 *   coverage  a section (## heading) of the checklist page that the quest page neither links to
 *             (`checklist.md#section`) nor lists as left out in a comment
 *             `<!-- quest-skips: slug, slug -->`
 *
 * Run by `npm run docs:links` (and so by CI and green), the Danish twins are not checked: the
 * wiki stamp check keeps them in step with their English page.
 *
 *   node scripts/docs-quest-check.mjs            check, exit 1 on a problem
 *   node scripts/docs-quest-check.mjs --root d   check another tree (tests)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { proseLines, slugify } from './check-links.mjs';

/** quest page -> the checklist page it is made from. */
export const QUESTS = {
  'docs/gm/first-hour-quest.md': 'docs/gm/first-hour.md',
  'docs/gm/before-session-quest.md': 'docs/gm/before-session.md',
  'docs/gm/prepare-session-0-quest.md': 'docs/gm/prepare-session-0.md',
};

/** A copied run this long (in words) is a second copy of a step. */
export const COPY_WORDS = 9;

/** Words of a text, lower case, markdown marks and punctuation dropped. */
export function words(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[`*_>#|]/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}'’-]+/u)
    .filter(Boolean);
}

/** Every run of n words as a string. */
function shingles(ws, n) {
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

/** Body of a page without its front matter. */
const body = text => text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '');

/** `## ` headings (not in code blocks) with their anchors, repeats numbered -1, -2 like GitHub. */
export function sections(text) {
  const seen = new Map();
  const out = [];
  for (const line of proseLines(body(text))) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (line.startsWith('## ')) {
      out.push({ title: m[1], slug: count === 0 ? base : `${base}-${count}` });
    }
  }
  return out;
}

/** Paragraphs (blocks between blank lines) with the line they start on, wrapped lines joined. */
function paragraphs(text) {
  const out = [];
  let cur = null;
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) {
      cur = null;
    } else if (!cur) {
      cur = { line: i + 1, text: line };
      out.push(cur);
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      cur = { line: i + 1, text: line };
      out.push(cur);
    } else {
      cur.text += ` ${line}`;
    }
  });
  return out;
}

export function check(root, quests = QUESTS) {
  const problems = [];
  for (const [questPath, listPath] of Object.entries(quests)) {
    const qf = path.join(root, questPath);
    const lf = path.join(root, listPath);
    if (!existsSync(qf) || !existsSync(lf)) {
      problems.push(`${questPath}: the quest page or its checklist page ${listPath} is missing`);
      continue;
    }
    const quest = body(readFileSync(qf, 'utf8'));
    const list = body(readFileSync(lf, 'utf8'));
    const listName = path.basename(listPath);

    // copy: lines of the quest whose words stand in a row in the checklist page
    const listRuns = shingles(words(list), COPY_WORDS);
    for (const para of paragraphs(quest)) {
      const ws = words(para.text);
      for (let k = 0; k + COPY_WORDS <= ws.length; k++) {
        const run = ws.slice(k, k + COPY_WORDS).join(' ');
        if (listRuns.has(run)) {
          problems.push(
            `${questPath}:${para.line}: copies ${listName} ("${run}..."); link to the step instead`
          );
          break;
        }
      }
    }

    // coverage: every section of the checklist is linked or skipped
    const prose = proseLines(quest.replace(/<!--[\s\S]*?-->/g, '')).join('\n');
    const linked = new Set(
      [...prose.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)]
        .filter(
          m =>
            path.posix.normalize(path.posix.join(path.posix.dirname(questPath), m[1])) === listPath
        )
        .map(m => m[2])
    );
    const skips = new Set(
      [...quest.matchAll(/<!--\s*quest-skips:\s*([^>]*?)\s*-->/g)]
        .flatMap(m => m[1].split(','))
        .map(s => s.trim())
        .filter(Boolean)
    );
    const secs = sections(list);
    const slugs = new Set(secs.map(s => s.slug));
    for (const s of secs) {
      if (!linked.has(s.slug) && !skips.has(s.slug)) {
        problems.push(
          `${questPath}: no link to "${s.title}" of ${listName}; add [..](${listName}#${s.slug}) or list the slug in <!-- quest-skips: ${s.slug} -->`
        );
      }
    }
    for (const k of skips) {
      if (!slugs.has(k))
        problems.push(`${questPath}: quest-skips names "${k}", which is no section of ${listName}`);
      else if (linked.has(k))
        problems.push(`${questPath}: "${k}" is both linked and in quest-skips`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.indexOf('--root');
  const root =
    rootArg > -1
      ? path.resolve(process.argv[rootArg + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const problems = check(root);
  if (problems.length) {
    console.error(
      `docs-quest: ${problems.length} problem(s). A quest page must link to the checklist steps, not copy them:`
    );
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(
    `docs-quest: ${Object.keys(QUESTS).length} quest pages link to their checklists, no copied steps`
  );
}
