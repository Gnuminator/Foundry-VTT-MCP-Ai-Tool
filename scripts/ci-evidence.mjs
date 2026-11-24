#!/usr/bin/env node
// Evidence for the ci-doctor agent: why is CI red on a PR head? Read-only. It runs only `gh pr view`,
// `gh run list`, `gh run view` and `gh api` GETs, and writes one text file the agent reads with
// Read and Grep (the agent has no shell, so it can neither push nor raise a baseline).
//
//   npm run ci:evidence -- <PR> [--head <sha>] [--out <file>] [--tail <lines>]
//
// `--head` looks at an older head of the PR instead of the current one (its checks are then not listed).
//
// The file lists each failed job and step of the newest failed ci.yml run on the PR head, the check
// annotations, the tail of the failed log, the PR merge state, and a first guess at the kind of failure.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';

/** Patterns for the known kinds, first match wins. Each kind has a fix hint the agent turns into a patch. */
export const KINDS = [
  [
    'conflict',
    /merge conflict|CONFLICT \(|CONFLICTING/i,
    'Merge aitool/main into the branch; generated tools docs: take either side, run npm run docs:tools.',
  ],
  [
    'ratchet',
    /ratchet|baseline (grew|exceeded)|em-dash.*(baseline|found)|lint-baseline|line-baseline/i,
    'A baseline grew: remove the new offence, or if CI reports a drop run npm run lint:ratchet -- --update. Never raise a baseline.',
  ],
  [
    'tools-sweep',
    /docs:tools|tool.*(count|sweep)|write-gate|tool-sets|exactly one set/i,
    'A new tool or handler missed a step: write-gate.ts entry, one set, npm run docs:tools, count tests.',
  ],
  ['changelog', /changelog/i, 'Add changelog.d/<topic>.md in the README format.'],
  [
    'format-lint',
    /prettier|eslint|markdownlint|MD0\d\d|docs:links|broken link/i,
    'Run the formatter or linter on the named file; fix the named rule.',
  ],
  ['typecheck', /error TS\d+/, 'Fix the named type error at the file and line.'],
  [
    'hang',
    /timed out|timeout of \d+|exceeded the maximum execution time|operation was canceled/i,
    'A hang or timeout: find the test or step that never ended; do not just rerun.',
  ],
  [
    'test',
    /AssertionError|not ok \d+|failing|expected .* to|FAIL /i,
    'A failing test: read the assertion and the test file; fix the code or the test.',
  ],
];

/** @param {string} text */
export function classify(text) {
  for (const [kind, re, hint] of KINDS) if (re.test(text)) return { kind, hint };
  return { kind: 'unknown', hint: 'No known pattern; read the log tail and say what is unclear.' };
}

/** The sweep names each failed command: "<name> failed (exit 1): <command>". */
export function failedCommands(text) {
  return [...text.matchAll(/^(?:##\[error\]|(?:failure|error) \S+ )?([\w:.-]+) failed \(exit \d+\): (.+)$/gm)].map(m => m[2].trim());
}

/**
 * The lines that say what failed: annotations and ##[error] lines with the few lines before each
 * (a passing test name or a step title must not decide the kind).
 * @param {string} log
 */
export function signal(log) {
  const lines = log.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => {
    if (l.startsWith('##[error]')) for (let k = Math.max(0, i - 8); k <= i; k++) keep.add(k);
  });
  return [...keep].sort((a, b) => a - b).map(i => lines[i]).filter(l => !/✓|✔/.test(l)).join('\n');
}

/** Kind from the failed command first (exact), then from the signal lines. */
export function diagnose(annotations, log) {
  const cmds = failedCommands(annotations + '\n' + log);
  for (const c of cmds) {
    if (/^(npm test|node --test|npx vitest)/.test(c) && /timed out|timeout of \d+|operation was canceled/i.test(signal(log)))
      return { ...classify('timed out'), via: c.length > 160 ? c.slice(0, 160) + ' ...' : c };
    if (/^(npm test|node --test|npx vitest)/.test(c)) return { ...classify('AssertionError'), via: c.length > 160 ? c.slice(0, 160) + ' ...' : c };
    if (/ratchet|em-dash|baseline/.test(c) && !/typecheck/.test(c)) return { ...classify('ratchet'), via: c };
    if (/typecheck/.test(c)) return { ...classify('error TS1'), via: c };
    if (/docs:tools|docs-tools/.test(c)) return { ...classify('docs:tools'), via: c };
    if (/changelog/.test(c)) return { ...classify('changelog'), via: c };
    if (/lint|prettier|markdownlint|docs:links/.test(c)) return { ...classify('eslint'), via: c };
    if (/\btest\b|node --test/.test(c)) return { ...classify('AssertionError'), via: c };
  }
  return { ...classify(annotations + '\n' + signal(log)), via: cmds[0] || '' };
}

/** @param {string} log @param {number} n */
export function tail(log, n) {
  return log.split(/\r?\n/).slice(-n).join('\n');
}

/** Strip the GitHub log prefix (job, step, timestamp) and ANSI colours. */
export function clean(log) {
  return log
    .replace(/(?:\x1b|\^)?\[[0-9;]{1,6}m/g, '')
    .replace(/^[^\t\n]*\t[^\t\n]*\t\d{4}-\d\d-\d\dT[\d:.]+Z /gm, '')
    .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, '');
}

function gh(args) {
  return new Promise(resolve => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }),
    );
  });
}

async function ghJson(args) {
  const r = await gh(args);
  if (!r.ok) throw new Error(`gh ${args.join(' ')}: ${r.err.trim() || 'failed'}`);
  return JSON.parse(r.out);
}

const BAD = ['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'CANCELLED', 'ACTION_REQUIRED'];

export async function collect(pr, tailLines, headOverride) {
  const view = await ghJson([
    'pr', 'view', String(pr), '--repo', REPO, '--json',
    'number,title,headRefOid,headRefName,mergeable,mergeStateStatus,statusCheckRollup',
  ]);
  const head = headOverride || view.headRefOid;
  const rollup = headOverride ? [] : view.statusCheckRollup || [];
  const failed = rollup.filter(c => BAD.includes(c.conclusion));
  const body = [];
  let annotations = '';
  let logs = '';
  const failedJobs = [];
  const files = await gh(['pr', 'diff', String(pr), '--repo', REPO, '--name-only']);
  const changed = files.ok ? files.out.trim().split(/\r?\n/).slice(0, 60).join(', ') : '';
  const conflicting = view.mergeable === 'CONFLICTING' && !headOverride;
  if (conflicting) {
    body.push('## Merge state', 'The PR conflicts with main (CONFLICTING).', '');
  }
  body.push('## Checks on the head', ...rollup.map(c => `- ${c.name || c.context}: ${c.conclusion || c.status || c.state}`), '');
  const runs = await ghJson([
    'run', 'list', '--repo', REPO, '-w', 'ci.yml', '--commit', head, '-L', '5',
    '--json', 'databaseId,conclusion,status,event,createdAt',
  ]);
  const run = runs.find(r => ['failure', 'timed_out', 'startup_failure', 'cancelled'].includes(r.conclusion)) || runs[0];
  if (run && runs[0] && runs[0].conclusion === 'success' && run !== runs[0])
    body.push('## Note', `The newest run ${runs[0].databaseId} succeeded; the failure below is from an older run (${run.databaseId}) and may be stale.`, '');
  if (!run) {
    body.push('## Runs', 'No ci.yml run found for this head.');
  } else {
    const detail = await ghJson(['run', 'view', String(run.databaseId), '--repo', REPO, '--json', 'jobs,conclusion,url']);
    body.push(`## Run ${run.databaseId} (${detail.conclusion}) ${detail.url}`);
    const cancelled = detail.jobs.filter(j => j.conclusion === 'cancelled').map(j => j.name);
    if (cancelled.length) body.push(`cancelled jobs (no cause of their own): ${cancelled.join(', ')}`, '');
    for (const job of detail.jobs.filter(j => j.conclusion && !['success', 'skipped', 'cancelled'].includes(j.conclusion))) {
      failedJobs.push(job.name);
      const steps = (job.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name);
      body.push(`### Job ${job.name}: ${job.conclusion}`, `failed steps: ${steps.join(', ') || '(none named)'}`);
      const ann = await gh([
        'api', `repos/${REPO}/check-runs/${job.databaseId}/annotations`,
        '--jq', '.[] | "\\(.annotation_level) \\(.path):\\(.start_line) \\(.message)"',
      ]);
      if (ann.ok && ann.out.trim()) {
        body.push('annotations:', ann.out.trim());
        annotations += ann.out + '\n';
      }
      const log = await gh(['run', 'view', String(run.databaseId), '--repo', REPO, '--job', String(job.databaseId), '--log-failed']);
      const full = clean(log.out);
      const t = tail(full, tailLines);
      logs += full + '\n';
      body.push(`log tail (last ${tailLines} lines):`, '```', t, '```', '');
    }
  }
  const { kind, hint, via } = conflicting ? { ...classify('CONFLICTING'), via: 'PR state' } : diagnose(annotations, logs);
  const head1 = [
    `# CI evidence for PR ${view.number}: ${view.title}`,
    `head: ${head}`,
    `branch: ${view.headRefName}`,
    `mergeable: ${view.mergeable}, state: ${view.mergeStateStatus}`,
    `failed checks: ${[...new Set([...failed.map(c => c.name), ...failedJobs])].join(', ') || 'none'}`,
    `files changed by the PR: ${changed || '(not available)'}`,
    `failed command: ${via || '(none named)'}`,
    `first guess (from patterns, check it against the log): ${kind}`,
    `known fix: ${hint}`,
    '',
  ];
  return { text: [...head1, ...body].join('\n'), kind, head };
}

/** The PR number: the first bare number once each option and its value are dropped. */
export function prNumber(argv) {
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (['--head', '--out', '--tail'].includes(argv[i])) i++;
    else rest.push(argv[i]);
  }
  return rest.find(a => /^\d+$/.test(a));
}

async function main(argv) {
  const pr = prNumber(argv);
  const opt = n => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!pr) {
    console.error('usage: npm run ci:evidence -- <PR> [--out <file>] [--tail <lines>]');
    return 2;
  }
  const { text, kind, head } = await collect(pr, Number(opt('--tail')) || 150, opt('--head'));
  const out = opt('--out') || path.join(os.tmpdir(), `ci-evidence-${pr}-${head.slice(0, 8)}.txt`);
  fs.writeFileSync(out, text);
  console.log(`ci-evidence: ${out} (first guess: ${kind})`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then(
    c => process.exit(c),
    e => {
      console.error(`ci-evidence: ${e.message}`);
      process.exit(1);
    },
  );
}
