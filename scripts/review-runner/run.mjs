#!/usr/bin/env node
/**
 * Review runner on the API credit (D-127). Reviews one PR or a list with the Claude Agent SDK, on the
 * separate API key, and writes the review note the merge gate reads (lane skill, "Review note
 * format") to vault `Handoff/Reviews <date>/`, committed with explicit paths.
 *
 *   node scripts/review-runner/run.mjs 523 524 --dry-run     what would run, no key needed, no spend
 *   node scripts/review-runner/run.mjs 523                   one real review (needs REVIEW_RUNNER_API_KEY)
 *
 * Options: --model opus|sonnet (default: Opus when the merge gate calls the PR risky, D-101, else
 * Sonnet), --round N (default: next after the existing notes; round 3 needs --allow-round3, which is
 * the planner's call), --vault DIR, --ledger FILE, --no-commit, --max-turns N, --keep-scratch.
 *
 * Money: every review's cost (the SDK's total_cost_usd, from `usage`) is appended to the ledger
 * (~/.review-runner/ledger.jsonl) and the runner starts no review once the total reaches $95; each
 * review also has its own SDK budget (Opus $6, Sonnet $3) cut to what is left. A review that dies
 * without a result is booked at its full budget.
 *
 * The key: REVIEW_RUNNER_API_KEY is read here and handed to the SDK child process as
 * ANTHROPIC_API_KEY, in that child's environment only (this process never sets it). It is never
 * printed or written; output and errors are scrubbed. Install once with
 * `npm ci --prefix scripts/review-runner`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_BY_CATEGORY,
  KEY_VAR,
  MODEL_IDS,
  agentBody,
  appendLedger,
  budgetFor,
  buildPrompts,
  finishNote,
  nextRound,
  noteName,
  parseArgs,
  pickModel,
  readLedger,
  scrub,
  totalUsd,
} from './lib.mjs';

const ZONE = 'Europe/Copenhagen';
const GIT_TIMEOUT_MS = 120000;

/** @param {string} cmd @param {string[]} args @param {string} [cwd] */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** @param {string} cmd @param {string[]} args @param {string} [cwd] */
function must(cmd, args, cwd) {
  const r = run(cmd, args, cwd);
  if (!r.ok) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${r.err || r.out}`);
  return r.out;
}

const today = () =>
  new Intl.DateTimeFormat('sv', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date()
  );

/** @param {number} pr */
function prInfo(pr) {
  const j = JSON.parse(
    must('gh', ['pr', 'view', String(pr), '--json', 'title,body,state,headRefOid,files,isDraft'])
  );
  return {
    title: String(j.title),
    body: String(j.body ?? ''),
    state: String(j.state),
    sha: String(j.headRefOid),
    files: /** @type {{ path: string }[]} */ (j.files).map(f => f.path),
  };
}

/** Existing review note names of a PR, and where the vault keeps them. @param {string} vault @param {number} pr */
function existingNotes(vault, pr) {
  const root = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  /** @type {{ name: string, file: string }[]} */
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const d of fs.readdirSync(root)) {
    if (!/^Reviews\b/.test(d)) continue;
    for (const f of fs.readdirSync(path.join(root, d))) {
      if (f.startsWith(`${pr}-`) && f.endsWith('.md')) found.push({ name: f, file: path.join(root, d, f) });
    }
  }
  return found;
}

/**
 * Everything decided before any spend. Throws on a PR that cannot be reviewed.
 * @param {number} pr @param {import('./lib.mjs').Options} o @param {number} spent
 */
function plan(pr, o, spent) {
  const info = prInfo(pr);
  if (info.state !== 'OPEN') throw new Error(`PR #${pr} is ${info.state}, not open`);
  const picked = pickModel(info.files);
  const model = o.model ?? picked.model;
  const notes = existingNotes(o.vault, pr);
  const round = o.round ?? nextRound(
    notes.map(n => n.name),
    pr
  );
  if (round >= 3 && !o.allowRound3) {
    throw new Error(`PR #${pr} would be review round ${round}; a third round needs the planner (D-127). Pass --allow-round3 if the planner said so`);
  }
  const budget = budgetFor(spent, model);
  if (budget === null) throw new Error(`the $95 stop is reached (spent $${spent.toFixed(2)}); no review started`);
  const name = noteName(pr, model, round);
  const dir = path.join(o.vault, 'Dev', 'Foundry AI Tool', 'Handoff', `Reviews ${today()}`);
  const previous = round > 1 ? [...notes].sort((a, b) => a.name.localeCompare(b.name)).at(-1) ?? null : null;
  return { pr, ...info, model, categories: picked.categories, round, budget, name, dir, previous };
}

/** @param {ReturnType<typeof plan>} p */
function describe(p) {
  return `#${p.pr} ${p.title}\n  head ${p.sha}, ${p.files.length} files, model ${p.model} (${MODEL_IDS[p.model]}), round ${p.round}, budget $${p.budget}\n  risky: ${p.categories.join(', ') || 'no'}\n  note: ${path.join(p.dir, p.name)}`;
}

/**
 * One real review: scratch worktree at the head, SDK run, note written and committed, ledger line.
 * @param {ReturnType<typeof plan>} p @param {import('./lib.mjs').Options} o @param {string} key
 * @param {string} repo
 */
async function review(p, o, key, repo) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `review-runner-${p.pr}-`));
  const wt = path.join(scratch, 'wt');
  const diffPath = path.join(scratch, 'pr.diff');
  const bodyPath = path.join(scratch, 'pr-body.md');
  let worktreeMade = false;
  try {
    must('git', ['fetch', '-q', 'aitool', 'main'], repo);
    must('git', ['fetch', '-q', 'aitool', `refs/pull/${p.pr}/head`], repo);
    const fetched = must('git', ['rev-parse', 'FETCH_HEAD'], repo);
    if (fetched !== p.sha) throw new Error(`head moved: GitHub says ${p.sha}, fetched ${fetched}`);
    must('git', ['worktree', 'add', '--detach', '-q', wt, p.sha], repo);
    worktreeMade = true;
    fs.writeFileSync(diffPath, must('git', ['diff', `aitool/main...${p.sha}`], repo) + '\n');
    fs.writeFileSync(bodyPath, p.body);
    // CLAUDE.md is gitignored, so a fresh checkout has none; the reviewer is told to read it.
    const claudeMd = path.join(repo, 'CLAUDE.md');
    if (fs.existsSync(claudeMd) && !fs.existsSync(path.join(wt, 'CLAUDE.md'))) {
      fs.copyFileSync(claudeMd, path.join(wt, 'CLAUDE.md'));
    }

    const agentChecklists = [...new Set(p.categories.map(c => AGENT_BY_CATEGORY[c]).filter(Boolean))].map(a =>
      // From the runner's own checkout: an older PR branch may not have the agent files yet.
      agentBody(fs.readFileSync(path.join(repo, '.claude', 'agents', `${a}.md`), 'utf8'))
    );
    const { system, user } = buildPrompts({
      pr: p.pr,
      sha: p.sha,
      title: p.title,
      model: p.model,
      round: p.round,
      categories: p.categories,
      previousNote: p.previous?.file ?? null,
      diffPath,
      bodyPath,
      agentChecklists,
    });

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const env = { ...process.env, ANTHROPIC_API_KEY: key };
    delete env[KEY_VAR];
    const started = Date.now();
    /** @type {any} */
    let result = null;
    let apiKeySource = '';
    try {
      for await (const m of query({
        prompt: user,
        options: {
          cwd: wt,
          model: MODEL_IDS[p.model],
          systemPrompt: system,
          tools: ['Read', 'Grep', 'Glob'],
          allowedTools: ['Read', 'Grep', 'Glob'],
          permissionMode: 'dontAsk',
          additionalDirectories: [scratch, ...(p.previous ? [path.dirname(p.previous.file)] : [])],
          settingSources: [],
          persistSession: false,
          maxTurns: o.maxTurns,
          maxBudgetUsd: p.budget,
          env,
        },
      })) {
        if (m.type === 'system' && m.subtype === 'init') {
          apiKeySource = String(m.apiKeySource);
          if (apiKeySource !== 'ANTHROPIC_API_KEY') {
            throw new Error(`the SDK uses "${apiKeySource}", not the review key; stopping before any spend on the wrong account`);
          }
        }
        if (m.type === 'result') result = m;
      }
    } catch (e) {
      if (!result) {
        appendLedger(o.ledger, {
          ts: new Date().toISOString(),
          pr: p.pr,
          sha: p.sha,
          model: p.model,
          round: p.round,
          costUsd: apiKeySource === 'ANTHROPIC_API_KEY' ? p.budget : 0,
          booked: apiKeySource === 'ANTHROPIC_API_KEY' ? 'full budget, no result' : 'no spend, stopped at init',
        });
      }
      throw e;
    }
    if (!result) throw new Error('the SDK ended without a result');

    const costUsd = Number(result.total_cost_usd) || 0;
    appendLedger(o.ledger, {
      ts: new Date().toISOString(),
      pr: p.pr,
      sha: p.sha,
      model: p.model,
      round: p.round,
      costUsd,
      turns: result.num_turns,
      durationMs: Date.now() - started,
      subtype: result.subtype,
      usage: result.usage && {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens,
        cacheRead: result.usage.cache_read_input_tokens,
        cacheWrite: result.usage.cache_creation_input_tokens,
      },
      modelUsage: result.modelUsage,
    });
    if (result.subtype !== 'success') throw new Error(`the review ended with ${result.subtype} ($${costUsd.toFixed(2)} spent); no note written`);

    const { text, problems } = finishNote(String(result.result), p.pr, p.model, p.sha, p.name);
    if (problems.length > 0) {
      const raw = path.join(os.tmpdir(), `review-runner-${p.pr}-rejected.md`);
      fs.writeFileSync(raw, text);
      throw new Error(`the answer is not a valid note (${problems.join('; ')}); kept at ${raw}`);
    }
    fs.mkdirSync(p.dir, { recursive: true });
    const file = path.join(p.dir, p.name);
    fs.writeFileSync(file, text);
    if (!o.noCommit) commitNote(o.vault, file, p.pr);
    return { costUsd, turns: Number(result.num_turns), file };
  } finally {
    if (!o.keepScratch) {
      if (worktreeMade) run('git', ['worktree', 'remove', '--force', wt], repo);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

/** Commit exactly the note and push (one pull --rebase retry). @param {string} vault @param {string} file @param {number} pr */
function commitNote(vault, file, pr) {
  run('git', ['pull', '--rebase', '-q'], vault);
  const rel = path.relative(vault, file).split(path.sep).join('/');
  must('git', ['add', '--', rel], vault);
  must('git', ['commit', '-q', '-m', `Review note for PR #${pr} (review runner)`, '--', rel], vault);
  if (!run('git', ['push', '-q'], vault).ok) {
    run('git', ['pull', '--rebase', '-q'], vault);
    must('git', ['push', '-q'], vault);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const key = process.env[KEY_VAR] ?? '';
  if (!o.dryRun && !key) {
    console.error(`${KEY_VAR} is not set; the review runner will not start without it (use --dry-run to see the plan)`);
    process.exit(1);
  }
  const repo = must('git', ['rev-parse', '--show-toplevel']);
  let spent = totalUsd(readLedger(o.ledger));
  console.log(`review-runner: ${o.dryRun ? 'DRY RUN, nothing is spent. ' : ''}spent so far $${spent.toFixed(2)} of $95`);
  let failed = 0;
  for (const pr of o.prs) {
    try {
      const p = plan(pr, o, spent);
      if (o.dryRun) {
        console.log(`would review ${describe(p)}`);
        continue;
      }
      console.log(`reviewing ${describe(p)}`);
      const r = await review(p, o, key, repo);
      spent = totalUsd(readLedger(o.ledger));
      console.log(`  done: $${r.costUsd.toFixed(2)}, ${r.turns} turns, ${r.file}\n  total spent $${spent.toFixed(2)} of $95`);
    } catch (e) {
      failed++;
      console.error(scrub(`#${pr}: ${e instanceof Error ? e.message : String(e)}`, key));
      spent = totalUsd(readLedger(o.ledger));
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(e => {
    console.error(scrub(e instanceof Error ? e.message : String(e), process.env[KEY_VAR] ?? ''));
    process.exit(1);
  });
}
