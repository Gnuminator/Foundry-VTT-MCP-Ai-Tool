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
