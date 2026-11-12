#!/usr/bin/env node
/**
 * Review note helper: nobody types the note header. The reviewer's text goes in a file; this script
 * reads the PR's head sha with gh, names the note the way the merge gate reads it, writes the
 * "Head reviewed:" and verdict lines, checks the result with the gate's own parser, then commits
 * and pushes that one path in the vault.
 *
 *   node scripts/review-note.mjs <PR> --verdict merge|fixes|no --model opus|sonnet --body FILE
 *     [--round N] [--head SHA] [--vault DIR] [--no-commit] [--dry-run]
 *
 * It refuses `--model sonnet` when the gate calls the PR risky (an Opus review is required).
 * Tests: scripts/review-note.test.mjs. The pure parts (noteName, finishNote, buildNote) are exported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseReviewNote, riskyHits } from './lane-merge.mjs';

/** The verdicts the gate accepts, lower case, without the full stop. */
export const VERDICTS = ['merge', 'merge after fixes', 'do not merge'];
/** The `--verdict` flag values and the bold text each writes. */
export const VERDICT_FLAGS = {
  merge: '**Merge.**',
  fixes: '**Merge after fixes.**',
  no: '**Do not merge.**',
};
const ZONE = 'Europe/Copenhagen';

/** File name of a review note. @param {number} pr @param {'opus' | 'sonnet'} model @param {number} round */
export function noteName(pr, model, round) {
  return `${pr}-${model === 'opus' ? 'opus-' : ''}review${round > 1 ? `-round${round}` : ''}.md`;
}

/** The highest review round among a PR's note names (else 0). @param {string[]} names @param {number} pr */
export function latestRound(names, pr) {
  let round = 0;
  const re = new RegExp(`^${pr}-(?:opus-)?review(?:-round(\\d+))?\\.md$`, 'i');
  for (const n of names) {
    const m = re.exec(n);
    const r = m ? (m[1] ? Number(m[1]) : 1) : 0;
    if (r > round) round = r;
  }
  return round;
}

/**
 * Turn the reviewer's text into a note the merge gate accepts: drops any `Head reviewed:` line the
 * text carries and puts the real one on its own line above the single `## Verdict`. Returns the text
 * and the reasons it is not acceptable (empty when it is).
 * @param {string} answer @param {number} pr @param {'opus' | 'sonnet'} model @param {string} sha
 * @param {string} name
 * @returns {{ text: string, problems: string[] }}
 */
export function finishNote(answer, pr, model, sha, name) {
  const problems = [];
  const lines = answer
    .replace(/^\s*```(?:markdown|md)?\s*\r?\n/, '')
    .replace(/\r?\n```\s*$/, '')
    .trim()
    .split(/\r?\n/)
    .filter(l => !/^\s*(?:[-*]\s+)?(?:\*\*)?Head reviewed:/i.test(l))
    // The house style has no em dashes; the vault is not scanned, so fix it here.
    .map(l => l.replace(new RegExp('\\s*\\u2014\\s*', 'g'), ', '));
  const verdicts = lines.map((l, i) => (/^##\s+Verdict\b/i.test(l) ? i : -1)).filter(i => i >= 0);
  if (verdicts.length !== 1) {
    problems.push(`expected one "## Verdict" section, found ${verdicts.length}`);
    return { text: lines.join('\n') + '\n', problems };
  }
  lines.splice(verdicts[0], 0, `Head reviewed: ${sha}`, '');
  const text = lines.join('\n') + '\n';
  const note = parseReviewNote(name, text, pr);
  if (note.malformed.length > 0) problems.push(...note.malformed);
  if (note.entries.length !== 1 || note.entries[0].head !== sha) {
    problems.push('the verdict is not tied to the head sha');
  }
  const verdict = note.entries[0]?.verdict?.replace(/[.\s]+$/, '').toLowerCase() ?? '';
  if (!VERDICTS.includes(verdict)) problems.push(`unknown verdict "${note.entries[0]?.verdict ?? ''}"`);
  if (note.opus !== (model === 'opus')) {
    problems.push(
      model === 'opus'
        ? 'the heading must start "# PR #N Opus review"'
        : 'a Sonnet note must not be named or headed as an Opus review'
    );
  }
  return { text, problems };
}

/**
 * The finished note for a reviewer's text. The text may hold its own `## Verdict` section (its first
 * bold text must then match `--verdict`), else the helper appends one. A missing `# ` heading is
 * added in the form the gate reads (`# PR #N Opus review: ...`).
 * @param {{ pr: number, model: 'opus' | 'sonnet', round: number, sha: string,
 *   verdict: keyof typeof VERDICT_FLAGS, body: string }} c
 * @returns {{ name: string, text: string, problems: string[] }}
 */
export function buildNote(c) {
  const name = noteName(c.pr, c.model, c.round);
  const bold = VERDICT_FLAGS[c.verdict];
  let body = c.body.replace(/\r\n/g, '\n').trim();
  const problems = [];
  if (!/^#\s+/.test(body)) {
    body = `# PR #${c.pr} ${c.model === 'opus' ? 'Opus review' : 'review'}${c.round > 1 ? `, round ${c.round}` : ''}\n\n${body}`;
  }
  const at = body.search(/^##\s+Verdict\b/im);
  if (at < 0) {
    body = `${body}\n\n## Verdict\n\n${bold}`;
  } else {
    const first = /\*\*[^*]+\*\*/.exec(body.slice(at));
    if (!first || first[0] !== bold) {
      problems.push(`the text's own verdict (${first ? first[0] : 'none'}) does not match --verdict ${c.verdict} (${bold})`);
    }
  }
  const done = finishNote(body, c.pr, c.model, c.sha, name);
  return { name, text: done.text, problems: [...problems, ...done.problems] };
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseArgs(argv, env = process.env) {
  const o = {
    pr: 0,
    verdict: /** @type {keyof typeof VERDICT_FLAGS | null} */ (null),
    model: /** @type {'opus' | 'sonnet' | null} */ (null),
    body: /** @type {string | null} */ (null),
    round: /** @type {number | null} */ (null),
    head: /** @type {string | null} */ (null),
    vault: env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault'),
    noCommit: false,
    dryRun: false,
  };
  const value = (/** @type {number} */ i, /** @type {string} */ flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-commit') o.noCommit = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--verdict') {
      const v = value(i++, a);
      if (!(v in VERDICT_FLAGS)) throw new Error('--verdict must be merge, fixes or no');
      o.verdict = /** @type {keyof typeof VERDICT_FLAGS} */ (v);
    } else if (a === '--model') {
      const m = value(i++, a);
      if (m !== 'opus' && m !== 'sonnet') throw new Error('--model must be opus or sonnet');
      o.model = m;
    } else if (a === '--round') {
      const n = Number(value(i++, a));
      if (!Number.isInteger(n) || n < 1) throw new Error('--round must be a whole number from 1');
      o.round = n;
    } else if (a === '--head') {
      const h = value(i++, a);
      if (!/^[0-9a-f]{40}$/i.test(h)) throw new Error('--head needs the full 40-character sha');
      o.head = h.toLowerCase();
    } else if (a === '--body') o.body = value(i++, a);
    else if (a === '--vault') o.vault = value(i++, a);
    else if (/^#?\d+$/.test(a) && o.pr === 0) o.pr = Number(a.replace('#', ''));
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.pr) throw new Error('give the PR number');
  if (!o.verdict) throw new Error('--verdict merge|fixes|no is required');
  if (!o.model) throw new Error('--model opus|sonnet is required');
  if (!o.body) throw new Error('--body FILE (the reviewer\'s text) is required');
  return /** @type {typeof o & { verdict: keyof typeof VERDICT_FLAGS, model: 'opus' | 'sonnet', body: string }} */ (o);
}

/** The refusal for a Sonnet stamp on a risky PR, else null. @param {'opus' | 'sonnet'} model @param {string[]} files */
export function modelRefusal(model, files) {
  const hits = riskyHits(files);
  if (model === 'sonnet' && hits.length > 0) {
    return `PR is risky (${hits.map(h => h.name).join(', ')}: ${hits[0].file}); the gate needs an Opus review, so --model opus (npm run lane:risky prints the list)`;
  }
  return null;
}

/** @param {string} cmd @param {string[]} args @param {string} [cwd] */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** @param {string} cmd @param {string[]} args @param {string} [cwd] */
function must(cmd, args, cwd) {
  const r = run(cmd, args, cwd);
  if (!r.ok) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${r.err || r.out}`);
  return r.out;
}

const today = () =>
  new Intl.DateTimeFormat('sv', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * Bring the vault up to date without touching anyone else's work: fetch plus a fast-forward works with
 * a dirty tree (the shared vault often has other sessions' edits); no rebase, no autostash.
 * @param {string} vault
 */
function syncVault(vault) {
  must('git', ['fetch', '-q'], vault);
  must('git', ['merge', '--ff-only', '-q', '@{u}'], vault);
}

/**
 * Write the note, commit exactly that path and push; on a rejected push drop only our commit,
 * fast-forward and try again (3 tries).
 * @param {string} vault @param {string} file @param {string} text @param {number} pr
 */
function writeAndPush(vault, file, text, pr) {
  const rel = path.relative(vault, file).split(path.sep).join('/');
  for (let attempt = 1; attempt <= 3; attempt++) {
    syncVault(vault);
    if (fs.existsSync(file)) throw new Error(`${file} already exists; use another --round`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    must('git', ['add', '--', rel], vault);
    must('git', ['commit', '-q', '-m', `Review note for PR #${pr}`, '--', rel], vault);
    if (run('git', ['push', '-q'], vault).ok) return;
    must('git', ['reset', '-q', '--keep', 'HEAD~1'], vault);
  }
  throw new Error('the push was rejected 3 times; nothing was written');
}

/**
 * The files the PR changes, the way the gate sees them (a local diff against the merge base, not
 * `gh pr view`, which stops at 100 files). Throws when the PR head cannot be fetched or differs.
 * @param {number} pr @param {string} sha
 */
function changedFiles(pr, sha) {
  must('git', ['fetch', '-q', 'aitool', 'main']);
  must('git', ['fetch', '-q', 'aitool', `refs/pull/${pr}/head`]);
  const fetched = must('git', ['rev-parse', 'FETCH_HEAD']).toLowerCase();
  if (fetched !== sha) throw new Error(`PR #${pr} head moved while reading it (${fetched.slice(0, 8)}); run again`);
  return must('git', ['diff', '--name-only', '--no-renames', `aitool/main...${sha}`]).split(/\r?\n/).filter(Boolean);
}

/** @param {string[]} argv */
export function main(argv) {
  const o = parseArgs(argv);
  const info = JSON.parse(must('gh', ['pr', 'view', String(o.pr), '--json', 'state,headRefOid']));
  if (info.state !== 'OPEN') throw new Error(`PR #${o.pr} is ${info.state}, not open`);
  const sha = String(info.headRefOid).toLowerCase();
  if (o.head && o.head !== sha) {
    throw new Error(`PR #${o.pr} head is ${sha.slice(0, 8)} on GitHub, not ${o.head.slice(0, 8)}; review the new head`);
  }
  const refusal = modelRefusal(o.model, changedFiles(o.pr, sha));
  if (refusal) throw new Error(refusal);
  const handoff = path.join(o.vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  if (!o.noCommit && !o.dryRun) syncVault(o.vault);
  let existing = /** @type {string[]} */ ([]);
  if (fs.existsSync(handoff)) {
    for (const d of fs.readdirSync(handoff, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.startsWith('Reviews ')) existing.push(...fs.readdirSync(path.join(handoff, d.name)));
    }
  }
  const round = o.round ?? latestRound(existing, o.pr) + 1;
  const note = buildNote({
    pr: o.pr,
    model: o.model,
    round,
    sha,
    verdict: o.verdict,
    body: fs.readFileSync(o.body, 'utf8'),
  });
  if (note.problems.length > 0) throw new Error(`the note is not acceptable: ${note.problems.join('; ')}`);
  const file = path.join(handoff, `Reviews ${today()}`, note.name);
  if (o.dryRun) {
    console.log(`review-note: would write ${file} for head ${sha}`);
    return;
  }
  if (existing.includes(note.name)) throw new Error(`a note named ${note.name} already exists; use another --round`);
  if (o.noCommit) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, note.text);
  } else {
    writeAndPush(o.vault, file, note.text, o.pr);
  }
  console.log(`review-note: wrote ${file} (head ${sha}, ${o.verdict})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`review-note: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
