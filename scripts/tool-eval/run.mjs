#!/usr/bin/env node
/**
 * Tool eval (npm run tool-eval): runs the 22 cases of cases.mjs through `claude -p` on the
 * subscription (no API key, no paid API: D-066) against a stub MCP server that serves main's real
 * tool list, then scores the calls (score.mjs) and prints a report.
 *
 *   npm run tool-eval -- --models sonnet,haiku --samples 1
 *   npm run tool-eval -- --cases 1,2,3,4 --models sonnet      a small run
 *   npm run tool-eval -- --dry-run                             list the runs, start none
 *
 * Options: --models (sonnet, haiku, opus; default sonnet), --samples (default 1), --cases (ids;
 * a case that continues another runs its whole chat), --out <dir> (default %TEMP%/tool-eval-<time>),
 * --note <file> (also write the report as a Markdown note, e.g. into the vault), --timeout <s>
 * (per `claude` call, default 240), --dump <file> (reuse a tool list dump).
 *
 * Never binds a port: the stub talks stdio. It does not touch Foundry, the bridge or the vault.
 * This is Claude Code, not Claude Desktop: compare wordings with it, do not read it as a Desktop
 * score.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CASES, FIXTURE, chainOf } from './cases.mjs';
import { scoreTurn, summarize, verdict } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const MCP_NAME = 'foundry';
const CLAUDE = process.platform === 'win32' ? 'claude.exe' : 'claude';
const SYSTEM_PROMPT =
  'You are Claude, helping a game master run a D&D 5e game in Foundry VTT through the connected tools. ' +
  'Answer briefly. Use the tools when the request needs game data or a change.';

export function parseArgs(argv) {
  const opts = { models: ['sonnet'], samples: 1, cases: undefined, timeout: 240, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--models') opts.models = next().split(',').filter(Boolean);
    else if (a === '--samples') opts.samples = Number(next());
    else if (a === '--cases') opts.cases = next().split(',').map(Number);
    else if (a === '--out') opts.out = resolve(next());
    else if (a === '--note') opts.note = resolve(next());
    else if (a === '--timeout') opts.timeout = Number(next());
    else if (a === '--dump') opts.dump = resolve(next());
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(opts.samples) || opts.samples < 1) throw new Error('--samples must be 1 or more');
  return opts;
}

/** The chats to run: each is a chain of cases in order, no chat twice. */
export function planChats(caseIds) {
  const wanted = caseIds ?? CASES.map(c => c.id);
  const chats = [];
  const seen = new Set();
  for (const id of wanted) {
    const chain = chainOf(id);
    if (chain.length === 0) throw new Error(`No case ${id}`);
    const key = chain[0].id;
    if (seen.has(key)) continue;
    seen.add(key);
    // A chat runs from its first case to the last wanted case in it.
    const last = Math.max(...wanted.filter(w => chainOf(w)[0]?.id === key));
    chats.push(chainOf(last));
  }
  return chats;
}

/** Tool calls and final text of one `claude -p --output-format stream-json` run. */
export function parseStream(stdout) {
  const calls = [];
  let text = '';
  let sessionId;
  let usage;
  let isError = false;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'assistant') {
      for (const part of ev.message?.content ?? []) {
        if (part.type === 'tool_use') {
          calls.push({ name: part.name.replace(`mcp__${MCP_NAME}__`, ''), input: part.input });
        }
      }
    } else if (ev.type === 'result') {
      text = typeof ev.result === 'string' ? ev.result : '';
      sessionId = ev.session_id;
      isError = Boolean(ev.is_error);
      usage = ev.usage;
    }
  }
  return { calls, text, sessionId, usage, isError };
}

function tokenTotal(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function runClaude(args, env, cwd, timeoutS) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(CLAUDE, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeoutS * 1000);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => {
      // No claude binary on PATH (or not runnable): a usage-style failure, exit 2 from main().
      clearTimeout(timer);
      rejectPromise(new Error(`Could not start "${CLAUDE}" (${e.code ?? e.message}). Is Claude Code installed and on PATH?`));
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolvePromise({ code, out, err });
    });
  });
}

function ensureDump(opts, outDir) {
  if (opts.dump) return opts.dump;
  const file = join(outDir, 'tool-list.json');
  const r = spawnSync('npx vitest run src/tool-eval-dump.test.ts', {
    cwd: join(repoRoot, 'packages', 'mcp-server'),
    env: { ...process.env, TOOL_EVAL_DUMP: file, CI: 'true' },
    shell: true,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('Could not dump the tool list (is the shared package built?)');
  return file;
}

/** One chat (a chain of cases) with one model: returns one scored row per turn. */
async function runChat(chain, model, sample, ctx) {
  const results = { ...FIXTURE };
  for (const c of chain) Object.assign(results, c.results ?? {});
  const tag = `${chain[0].id}-${model}-${sample}`;
  const resultsFile = join(ctx.outDir, `results-${tag}.json`);
  writeFileSync(resultsFile, JSON.stringify(results));
  const mcpFile = join(ctx.outDir, `mcp-${tag}.json`);
  writeFileSync(
    mcpFile,
    JSON.stringify({
      mcpServers: {
        [MCP_NAME]: {
          command: process.execPath,
          args: [
            join(here, 'stub-server.mjs'),
            '--dump',
            ctx.dump,
            '--sets',
            chain[0].sets.join(','),
            '--results',
            resultsFile,
          ],
        },
      },
    })
  );
  const rows = [];
  let sessionId;
  for (const c of chain) {
    const args = [
      '-p',
      c.ask,
      '--model',
      model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      mcpFile,
      '--tools',
      '',
      '--allowedTools',
      `mcp__${MCP_NAME}`,
      '--permission-mode',
      'bypassPermissions',
      '--setting-sources',
      'project',
      '--disable-slash-commands',
      '--system-prompt',
      SYSTEM_PROMPT,
    ];
    if (sessionId) args.push('--resume', sessionId);
    const env = { ...process.env, ENABLE_TOOL_SEARCH: 'false' };
    // Subscription only (D-066): no API key, no Bedrock/Vertex/Foundry switch, any case.
    for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_USE_)/i.test(k)) delete env[k];
    const run = await runClaude(args, env, ctx.cwd, ctx.timeout);
    const parsed = parseStream(run.out);
    sessionId = parsed.sessionId ?? sessionId;
    writeFileSync(join(ctx.outDir, `stream-${tag}-case${c.id}.jsonl`), run.out);
    const score = scoreTurn(c, parsed.calls, parsed.text);
    if (run.code !== 0 || parsed.isError) {
      score.why.push(`run: claude exited ${run.code}${parsed.isError ? ' with an error result' : ''} ${run.err.slice(0, 200)}`);
      score.path = false;
      // A crashed or timed-out run made no calls, which would pass no-write; fail its gates instead.
      for (const g of c.gates ?? []) score.gates[g] = false;
    }
    rows.push({
      case: c.id,
      model,
      sample,
      calls: parsed.calls.map(x => x.name),
      text: parsed.text.slice(0, 400),
      tokens: tokenTotal(parsed.usage),
      ...score,
    });
  }
  return rows;
}

export function renderReport(rows, opts, meta) {
  const lines = [];
  lines.push(`# Tool eval ${meta.date}`, '');
  lines.push(`Head: \`${meta.sha}\`. Models: ${opts.models.join(', ')}. Samples: ${opts.samples}. Cases: ${meta.caseCount}.`);
  lines.push(`Runner: Claude Code ${meta.claudeVersion} in print mode on the subscription (no API key), stub MCP server with ${meta.toolCount} tools.`, '');
  lines.push('| Model | Turns | Path | Gates | Result | Tokens (all, incl. cache reads) |', '|---|---|---|---|---|---|');
  for (const model of opts.models) {
    const mine = rows.filter(r => r.model === model);
    const s = summarize(mine);
    const v = verdict(model, s);
    const tokens = mine.reduce((n, r) => n + r.tokens, 0);
    lines.push(
      `| ${model} | ${s.turns} | ${s.pathPass}/${s.turns} (${s.pathPct.toFixed(0)}%${v.target ? `, target ${v.target}%` : ''}) | ${s.gatesHeld}/${s.gateChecks} | ${v.ok ? 'pass' : 'FAIL'} | ${tokens.toLocaleString('en-US')} |`
    );
  }
  lines.push('', '## Misses', '');
  const misses = rows.filter(r => !r.path || Object.values(r.gates).some(g => !g));
  if (misses.length === 0) lines.push('None.');
  for (const r of misses) {
    lines.push(`- case ${r.case} (${r.model}, sample ${r.sample}): ${r.why.join('; ') || 'failed'}. Calls: ${r.calls.join(', ') || 'none'}.`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chats = planChats(opts.cases);
  const turns = chats.reduce((n, c) => n + c.length, 0);
  const runs = turns * opts.models.length * opts.samples;
  console.log(`tool-eval: ${chats.length} chats, ${turns} turns, ${opts.models.join('+')} x ${opts.samples} = ${runs} claude calls`);
  if (opts.dryRun) {
    for (const c of chats) console.log(`  cases ${c.map(x => x.id).join(' > ')}: sets ${c[0].sets.join(',')}`);
    return;
  }
  const outDir = opts.out ?? join(tmpdir(), `tool-eval-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  const cwd = mkdtempSync(join(tmpdir(), 'tool-eval-cwd-')); // outside the repo: no CLAUDE.md loads
  const dump = ensureDump(opts, outDir);
  const toolCount = JSON.parse(readFileSync(dump, 'utf8')).tools.length;
  const ctx = { outDir, cwd, dump, timeout: opts.timeout };

  const rows = [];
  for (const model of opts.models) {
    for (let sample = 1; sample <= opts.samples; sample++) {
      for (const chain of chats) {
        const got = await runChat(chain, model, sample, ctx);
        rows.push(...got);
        for (const r of got) console.log(`  case ${r.case} ${model}#${sample}: ${r.path ? 'ok' : 'MISS'} [${r.calls.join(', ')}]`);
      }
    }
  }
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  const claudeVersion = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8' }).stdout.trim();
  const report = renderReport(rows, opts, {
    date: new Date().toISOString().slice(0, 10),
    sha,
    claudeVersion,
    toolCount,
    caseCount: new Set(rows.map(r => r.case)).size,
  });
  writeFileSync(join(outDir, 'report.md'), report);
  writeFileSync(join(outDir, 'rows.json'), JSON.stringify(rows, null, 2));
  if (opts.note) writeFileSync(opts.note, report);
  console.log('\n' + report);
  console.log(`Details: ${outDir}`);
  const failed = opts.models.some(m => !verdict(m, summarize(rows.filter(r => r.model === m))).ok);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e.message);
    process.exit(2);
  });
}
