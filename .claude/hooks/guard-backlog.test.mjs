// Tests for guard-backlog.mjs:  node --test .claude/hooks/guard-backlog.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, isLane, run } from './guard-backlog.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard-backlog.mjs');
const LANE = 'C:\\Users\\me\\Projects\\Foundry VTT AI Tool\\.claude\\worktrees\\brave-x';
const MAIN = 'C:\\Users\\me\\Projects\\Foundry VTT AI Tool';
const VAULT = 'C:\\Users\\me\\Documents\\Obsidian\\vault\\Dev\\Foundry AI Tool';
const NOENV = {};
const call = (/** @type {string} */ tool, /** @type {object} */ toolInput, projectDir = LANE) =>
  decide(tool, { cwd: LANE, tool_input: toolInput }, { CLAUDE_PROJECT_DIR: projectDir });

test('a lane is a session whose project dir or transcript folder is a worktree, never its cwd', () => {
  assert.ok(isLane({}, { CLAUDE_PROJECT_DIR: LANE }));
  assert.ok(isLane({}, { CLAUDE_PROJECT_DIR: '/home/me/repo/.claude/worktrees/x/scripts' }));
  assert.ok(
    isLane(
      { transcript_path: 'C:\\u\\.claude\\projects\\C--r--claude-worktrees-brave-x\\a.jsonl' },
      { CLAUDE_PROJECT_DIR: MAIN }
    )
  );
  assert.ok(
    !isLane({ cwd: LANE }, { CLAUDE_PROJECT_DIR: MAIN }),
    'a planner that cd-ed into a worktree'
  );
  assert.ok(!isLane({}, NOENV));
});

test("the advice names main's copy of the tool, so a lane branched before the merge can run it", () => {
  const r = call('Edit', { file_path: `${VAULT}\\Backlog.md` }) ?? '';
  assert.ok(r.includes('C:/Users/me/Projects/Foundry VTT AI Tool/scripts/backlog.mjs'), r);
});

test('Edit, Write, MultiEdit and NotebookEdit on Backlog.md and Backlog done.md are denied in a lane', () => {
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    assert.match(
      call(tool, { file_path: `${VAULT}\\Backlog.md` }) ?? '',
      /scripts\/backlog\.mjs/,
      tool
    );
    assert.ok(call(tool, { file_path: `${VAULT}/Backlog done.md` }), `${tool} done`);
    assert.ok(
      call(tool, {
        file_path: 'c:/users/me/documents/obsidian/vault/dev/foundry ai tool/BACKLOG.MD',
      }),
      `${tool} case`
    );
  }
  assert.ok(call('NotebookEdit', { notebook_path: `${VAULT}\\Backlog.md` }));
});

test('other files, the planner and the board are not touched', () => {
  assert.equal(call('Edit', { file_path: `${VAULT}\\Waiting.md` }), null);
  assert.equal(call('Edit', { file_path: `${VAULT}\\Lows\\CI.md` }), null);
  assert.equal(
    call('Write', { file_path: `${LANE}\\docs\\Backlog.md` }),
    null,
    'a repo file of the same name'
  );
  assert.equal(call('Edit', { file_path: `${VAULT}\\Backlog.md` }, MAIN), null, 'the planner');
  assert.equal(call('Read', { file_path: `${VAULT}\\Backlog.md` }), null);
});

test('shell commands that write the Backlog are denied; reads and the tool pass', () => {
  const denied = [
    `node -e "fs.writeFileSync(f, t)" "${VAULT}\\Backlog.md"`,
    `echo "- claimed: x" >> "${VAULT}/Backlog.md"`,
    `cd "${VAULT}" && sed -i 's/a/b/' Backlog.md`,
    `Set-Content -Path "${VAULT}\\Backlog.md" -Value $t`,
    `cd vault && git add "Dev/Foundry AI Tool/Backlog.md" && git commit -m x`,
    `cp /tmp/x.md "Dev/Foundry AI Tool/Backlog done.md"`,
    `cat x | tee "Backlog.md"`,
    `node scripts/backlog.mjs status && echo x >> "${VAULT}/Backlog.md"`,
  ];
  for (const command of denied) {
    assert.ok(call('Bash', { command }), command);
    assert.ok(call('PowerShell', { command }), `PowerShell ${command}`);
  }
  const allowed = [
    `grep -n "backlog-tool" "${VAULT}/Backlog.md"`,
    `cat "${VAULT}/Backlog.md" | head -40`,
    `sed -n 1,40p "${VAULT}/Backlog.md"`,
    `git -C vault log -3 -- "Dev/Foundry AI Tool/Backlog.md"`,
    'node scripts/backlog.mjs claim backlog-tool "My lane" --link claude://x',
    'node scripts/backlog.mjs progress x "Backlog.md writes are fine through the tool"',
    'echo hi > out.txt',
    'git commit -m "lanes stop hand-editing Backlog.md"',
    `node "${MAIN}/scripts/backlog.mjs" progress x "a; b > c"`,
  ];
  for (const command of allowed) assert.equal(call('Bash', { command }), null, command);
  assert.equal(
    call('Bash', { command: `echo x >> "${VAULT}/Backlog.md"` }, MAIN),
    null,
    'the planner'
  );
});

test('the two shell gaps: a script that opens the Backlog for writing, and a bulk git add or commit in the vault', () => {
  const denied = [
    `python -c "open(r'${VAULT}\\Backlog.md','a').write('x')"`,
    `python -c "open('${VAULT}/Backlog.md', 'w').write('x')"`,
    `python -c "open('Dev/Foundry AI Tool/Backlog.md', mode='r+')"`,
    `node -e "require('fs').openSync('${VAULT}/Backlog.md','a')"`,
    `python -c "import pathlib; pathlib.Path('${VAULT}/Backlog.md').write_text('x')"`,
    `git -C C:/Users/me/Documents/Obsidian/vault commit -am "x"`,
    `cd "C:/Users/me/Documents/Obsidian/vault" && git commit -a -m x`,
    `cd vault && git commit --all -m x`,
    `cd vault && git add -A && git commit -m x`,
    `cd vault && git add .`,
    `cd vault && git add "Dev/Foundry AI Tool"`,
    `git -C C:/Users/me/Documents/Obsidian/vault add -u`,
    `cd vault && git add Waiting.md "Dev/Foundry AI Tool/Backlog.md"`,
    `cd vault && git commit -m x "Dev/Foundry AI Tool/Backlog.md"`,
    `cd vault && git commit -m x -- .`,
    `cd vault && git commit -m x "Dev/Foundry AI Tool"`,
    `cd vault && git add "Dev/Foundry AI Tool/*.md"`,
    `cd vault && git checkout -- .`,
    `cd vault && git restore "Dev/Foundry AI Tool"`,
    `cd vault && git checkout -- "Dev/Foundry AI Tool"`,
    `cd vault && git checkout -f main`,
    `cd vault && cd "Dev/Foundry AI Tool" && git add .`,
    `cd vault && git restore .`,
    `cd vault && git reset --hard`,
    `cd vault && git stash`,
    `Set-Location "C:/Users/me/Documents/Obsidian/vault"; git add -A`,
    `pushd vault && git add -A`,
    `python -c "import pathlib; pathlib.Path('${VAULT}/Backlog.md').open('w')"`,
    `[IO.File]::WriteAllText("${VAULT}\\Backlog.md", $t)`,
    `python -c "import shutil; shutil.copy('x', '${VAULT}/Backlog.md')"`,
    `node -e "fs.renameSync('x', '${VAULT}/Backlog.md')"`,
  ];
  for (const command of denied) {
    assert.ok(call('Bash', { command }), command);
    assert.ok(call('PowerShell', { command }), `PowerShell ${command}`);
  }
  assert.match(call('Bash', { command: 'cd vault && git add .' }) ?? '', /scripts\/backlog\.mjs/);
  const allowed = [
    `python -c "print(open(r'${VAULT}\\Backlog.md').read()[:100])"`,
    `python -c "print(open('${VAULT}/Backlog.md', 'r').read())"`,
    `python -c "open('out.txt','w').write('x')"`,
    `cd vault && git add Waiting.md "Dev/Foundry AI Tool/Lows/CI.md" && git commit -m "waiting: x"`,
    `cd vault && git commit -m "add all the things" -m "-a"`,
    `cd vault && git status && git diff`,
    `git add -A && git commit -am "in the repo, not the vault"`,
    `cd vault && git push && git pull --rebase`,
    `cd vault && git add Waiting.md 2>&1`,
    `cd vault && git add Waiting.md > NUL`,
    `cd vault && git add Waiting.md *> $null`,
    `cd vault && git commit --author "Bot <b@x>" --date "2026-11-13" -m x Waiting.md`,
    `grep -n "rename" "${VAULT}/Backlog.md"`,
    `git log --grep rename -- "Dev/Foundry AI Tool/Backlog.md"`,
    `cd vault && git restore --staged Waiting.md`,
    `cd vault && git add Waiting.md 2>&1 | tail -3`,
    `cd vault && git commit -m "git add -A was wrong" Waiting.md`,
    `cd vault && git checkout main && git stash list && git stash pop && git reset HEAD~1`,
    `cd vault && git status; cd "C:/Users/me/Projects/Foundry VTT AI Tool" && git add -A`,
    `cd C:/repo/packages/cogm-dashboard/src/player-vault && git add -A`,
    `git commit -am "Obsidian vault export fix"`,
    `git -C vault log -3; git add -A`,
    `python -c "print(open('${VAULT}/Backlog.md', encoding='utf-8').read())"`,
    `Set-Location vault; Get-Content Backlog.md | Select-Object -First 5`,
  ];
  for (const command of allowed) assert.equal(call('Bash', { command }), null, command);
  assert.ok(
    decide(
      'Bash',
      {
        cwd: 'C:\\Users\\me\\Documents\\Obsidian\\vault',
        tool_input: { command: 'git add .' },
      },
      { CLAUDE_PROJECT_DIR: LANE }
    ),
    'cwd in the vault'
  );
  assert.ok(
    decide(
      'Bash',
      {
        cwd: 'C:\\Users\\me\\Documents\\Obsidian\\vault',
        tool_input: { command: 'cd Handoff && git add -A' },
      },
      { CLAUDE_PROJECT_DIR: LANE }
    ),
    'a relative cd inside the vault keeps the context'
  );
  assert.equal(
    call('Bash', { command: 'cd vault && git commit -am x' }, MAIN),
    null,
    'the planner stays free'
  );
});

test('a planner whose cwd is inside a worktree is not a lane', () => {
  const r = decide(
    'Edit',
    { cwd: LANE, tool_input: { file_path: `${VAULT}\\Backlog.md` } },
    { CLAUDE_PROJECT_DIR: MAIN }
  );
  assert.equal(r, null);
});

test('run prints a PreToolUse deny; the hook fails open on junk input', () => {
  const out = JSON.parse(
    run(
      { tool_name: 'Edit', cwd: LANE, tool_input: { file_path: `${VAULT}\\Backlog.md` } },
      { CLAUDE_PROJECT_DIR: LANE }
    )
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(
    out.hookSpecificOutput.permissionDecisionReason,
    /^Blocked by \.claude\/hooks\/guard-backlog\.mjs/
  );
  assert.equal(
    run(
      { tool_name: 'Edit', cwd: MAIN, tool_input: { file_path: `${VAULT}\\Backlog.md` } },
      { CLAUDE_PROJECT_DIR: MAIN }
    ),
    ''
  );
  const env = { ...process.env, CLAUDE_PROJECT_DIR: MAIN };
  const junk = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env });
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, '');
  const real = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: 'Write',
      cwd: LANE,
      tool_input: { file_path: `${VAULT}\\Backlog.md` },
    }),
    encoding: 'utf8',
    env: { ...env, CLAUDE_PROJECT_DIR: LANE },
  });
  assert.match(real.stdout, /"permissionDecision":"deny"/);
});
