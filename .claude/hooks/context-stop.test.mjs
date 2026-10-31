// Tests for the context hard stop (context-stop.mjs): what is denied above the out line, what stays
// allowed, phantom doubled readings, subagents, and the lift under the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, decide, insideRepo, run, shellWritesRepo } from './context-stop.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'context-stop.mjs');

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'context-stop-test-'));
  const env = { CONTEXT_ALERT_THRESHOLDS_FILE: path.join(root, 'none.json') };
  return { root, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function turn(ctx, extra = {}) {
  const cacheRead = Math.floor(ctx * 0.9);
  const cacheCreate = Math.floor(ctx * 0.09);
  return JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg-${ctx}`,
      usage: {
        input_tokens: ctx - cacheRead - cacheCreate,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
        output_tokens: 5000,
      },
    },
    ...extra,
  });
}

function transcript(root, contexts, name = 't.jsonl') {
  const file = path.join(root, name);
  writeFileSync(file, `${contexts.map(c => turn(c)).join('\n')}\n`);
  return file;
}

const inRepo = (...p) => path.join(REPO_ROOT, ...p);
const outside = (...p) => path.join(os.tmpdir(), 'somewhere', ...p);

function payload(file, tool_name, tool_input, extra = {}) {
  return {
    session_id: 's',
    transcript_path: file,
    cwd: REPO_ROOT,
    tool_name,
    tool_input,
    ...extra,
  };
}

test('above the out line: edits of repo files, Agent and repo-writing commands are denied', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [410_000, 415_000]);
    const denied = [
      ['Edit', { file_path: inRepo('packages', 'x.ts') }],
      ['Write', { file_path: inRepo('a.md') }],
      ['MultiEdit', { file_path: inRepo('a.md') }],
      ['NotebookEdit', { notebook_path: inRepo('n.ipynb') }],
      ['Agent', { model: 'sonnet', prompt: 'x' }],
      ['Bash', { command: 'echo hi > out.txt' }],
      ['PowerShell', { command: 'Set-Content a.txt hello' }],
    ];
    for (const [tool, args] of denied) {
      const reason = decide(payload(file, tool, args), env);
      assert.match(reason ?? '', /hand-over line \(400k\).*Hand over now/, tool);
    }
    const out = JSON.parse(run(payload(file, 'Edit', { file_path: inRepo('a.ts') }), env));
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /context-stop\.mjs.*410k/);
  } finally {
    cleanup();
  }
});

test('above the out line: reads, outside writes, vault and scratchpad stay allowed', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [410_000, 415_000]);
    const allowed = [
      ['Read', { file_path: inRepo('a.ts') }],
      ['Grep', { pattern: 'x' }],
      ['Edit', { file_path: outside('Handoff', 'lane prompt.md') }],
      ['Write', { file_path: path.join(os.tmpdir(), 'scratchpad', 'n.txt') }],
      ['mcp__ccd_session__set_session_title', { title: 'x' }],
      ['Bash', { command: 'git add -A && git commit -m "a > b" && git push -u aitool b:b' }],
      ['Bash', { command: 'gh pr create --title x --body y' }],
      ['Bash', { command: "git commit -F - <<'EOF'\nuse sed -i and rm\nEOF" }],
      ['Bash', { command: 'git status && git diff aitool/main...HEAD | head -5' }],
      ['Bash', { command: 'cat a.ts > /dev/null 2>&1' }],
      [
        'Bash',
        { command: 'cd "C:/Users/chris/Documents/Obsidian/vault" && git add -A && git pull' },
      ],
      ['Bash', { command: 'echo note > "C:/Users/chris/Documents/Obsidian/vault/Dev/x.md"' }],
      ['Bash', { command: 'npm run lane:beat -- "t" "handed over"' }],
      ['PowerShell', { command: 'Get-Content a.ts | Select-Object -First 3' }],
    ];
    for (const [tool, args] of allowed) {
      assert.equal(decide(payload(file, tool, args), env), null, `${tool} ${JSON.stringify(args)}`);
    }
  } finally {
    cleanup();
  }
});

test('under the line, and after a compact, nothing is denied', () => {
  const { root, env, cleanup } = fixture();
  try {
    const args = { file_path: inRepo('a.ts') };
    assert.equal(decide(payload(transcript(root, [380_000, 390_000]), 'Edit', args), env), null);
    assert.ok(
      decide(payload(transcript(root, [380_000, 405_000], 'a.jsonl'), 'Edit', args), env) === null
    );
    assert.ok(decide(payload(transcript(root, [405_000, 410_000], 'b.jsonl'), 'Edit', args), env));
    // after /compact the context falls and the deny lifts
    assert.equal(
      decide(
        payload(transcript(root, [405_000, 410_000, 90_000, 95_000], 'c.jsonl'), 'Edit', args),
        env
      ),
      null
    );
  } finally {
    cleanup();
  }
});

test('a doubled phantom reading never stops a session; the low-mode file sets the line', () => {
  const { root, env, cleanup } = fixture();
  try {
    const args = { file_path: inRepo('a.ts') };
    // Real triple 161,654 / 327,920 / 164,453 against the low-mode out line of 250k.
    const lowFile = path.join(root, 'th.json');
    writeFileSync(lowFile, JSON.stringify({ plan: 200_000, out: 250_000 }));
    const low = { CONTEXT_ALERT_THRESHOLDS_FILE: lowFile };
    for (const [i, seq] of [
      [161_654, 327_920],
      [327_920, 164_453],
      [161_654, 327_920, 164_453],
    ].entries()) {
      assert.equal(decide(payload(transcript(root, seq, `p${i}.jsonl`), 'Edit', args), low), null);
    }
    // Two big responses in a row are real.
    assert.ok(
      decide(payload(transcript(root, [255_000, 262_000], 'real.jsonl'), 'Edit', args), low)
    );
    // The same phantom is also no reason to stop at the default 400k line.
    assert.equal(
      decide(payload(transcript(root, [200_000, 420_000], 'q.jsonl'), 'Edit', args), env),
      null
    );
  } finally {
    cleanup();
  }
});

test('calls from a subagent are left alone; a missing transcript or bad input allows', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [410_000, 415_000]);
    const args = { file_path: inRepo('a.ts') };
    assert.equal(
      decide(payload(file, 'Edit', args, { agent_id: 'a1', agent_type: 'Explore' }), env),
      null
    );
    assert.equal(decide(payload(path.join(root, 'missing.jsonl'), 'Edit', args), env), null);
    assert.equal(decide(payload(file, 'Edit', {}), env), null);
    assert.equal(decide(null, env), null);
    assert.equal(decide({ tool_name: 'Edit' }, env), null);
    assert.equal(run('text', env), '');
  } finally {
    cleanup();
  }
});

test('insideRepo: relative paths resolve against cwd, separators and case do not matter', () => {
  assert.equal(insideRepo('a/b.ts', REPO_ROOT), true);
  assert.equal(insideRepo('..', REPO_ROOT), false);
  assert.equal(insideRepo(inRepo('x').replace(/\//g, '\\'), os.tmpdir()), true);
  assert.equal(insideRepo(inRepo('x').toUpperCase(), os.tmpdir()), true);
  assert.equal(insideRepo(outside('x'), REPO_ROOT), false);
  assert.equal(insideRepo(`${REPO_ROOT}-other/x`, REPO_ROOT), false);
});

test('shellWritesRepo: writing verbs and redirects count, reading and quoted text do not', () => {
  const yes = [
    'echo x > a.txt',
    'cat a >> b',
    'sed -i s/a/b/ file.ts',
    'rm -rf dist',
    'mkdir foo && touch foo/a',
    'npm ci',
    'npm run build -w packages/shared',
    'npx prettier --write src/a.ts',
    'git checkout -b x',
    'git pull',
    'git stash push',
    'Remove-Item -Recurse dist',
    'Get-Content a | Out-File b.txt',
    "node -e \"require('fs').writeFileSync('a','b')\"",
    'python - <<\'EOF\'\nopen("a","w").write("x")\nEOF',
    'tee out.log',
  ];
  const no = [
    'ls -la',
    'git log --oneline -5 > /dev/null',
    'grep -rn "a > b" src',
    'npm test',
    'npm run lane:beat -- t claimed',
    'node scripts/green.mjs --quick',
    'echo "rm -rf x" | head',
    'a=1; echo $a 2>&1',
    'cd /tmp && rm -rf foo',
  ];
  for (const c of yes) assert.equal(shellWritesRepo(c, REPO_ROOT), true, c);
  for (const c of no) assert.equal(shellWritesRepo(c, REPO_ROOT), false, c);
  // an outside path elsewhere in the command does not exempt a repo write
  assert.equal(shellWritesRepo('npm ci 2>&1 | tee /tmp/ci.log', REPO_ROOT), true);
  assert.equal(shellWritesRepo('rm -rf dist && cat /tmp/x', REPO_ROOT), true);
  assert.equal(shellWritesRepo('npm test 2>&1 | tee /tmp/ci.log', REPO_ROOT), false);
  assert.equal(shellWritesRepo('cd /tmp/work && rm -rf foo && cd - && ls', REPO_ROOT), false);
  assert.equal(
    shellWritesRepo(`cd ${os.tmpdir()}/x && touch a; cd "${REPO_ROOT}" && touch b`, REPO_ROOT),
    true
  );
  // a command run from outside the repo that never names it is not a repo write
  assert.equal(shellWritesRepo('rm -rf foo', os.tmpdir()), false);
  assert.equal(shellWritesRepo(`rm ${REPO_ROOT}/a`, os.tmpdir()), true);
});

test('the hook process: prints a deny as JSON, nothing on garbage stdin', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [410_000, 415_000]);
    const spawn = stdin =>
      spawnSync(process.execPath, [HOOK], {
        input: stdin,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    const r = spawn(JSON.stringify(payload(file, 'Edit', { file_path: inRepo('a.ts') })));
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
    for (const bad of ['not json', '', '{}']) {
      const g = spawn(bad);
      assert.equal(g.status, 0);
      assert.equal(g.stdout, '');
    }
  } finally {
    cleanup();
  }
});
