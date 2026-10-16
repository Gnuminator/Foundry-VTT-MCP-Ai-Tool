// Tests for guard-shell-edits.mjs:  node --test .claude/hooks/guard-shell-edits.test.mjs
// Every deny rule has a fixture that must fire, and the normal commands a lane runs must pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, decide, isRepoSource, pathTokens, run, splitBodies } from './guard-shell-edits.mjs';

const ROOT = 'C:/Users/test/repo';
const CWD = 'C:\\Users\\test\\repo';
const denied = cmd => decide(cmd, CWD, ROOT) !== null;
const allowed = cmd => decide(cmd, CWD, ROOT) === null;
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard-shell-edits.mjs');

test('sed -i and perl -i on repo source files are denied', () => {
  for (const c of [
    "sed -i 's/foo/bar/' packages/mcp-server/src/index.ts",
    "sed -i.bak -e 's/a/b/' scripts/green.mjs",
    "sed -Ei 's/a+/b/' docs/dev/ARCHITECTURE.md",
    "sed --in-place 's/a/b/' package.json",
    "cd packages && sed -i 's/x/y/' .claude/settings.json",
    "perl -pi -e 's/\\bfoo\\b/bar/' packages/shared/src/a.ts",
    "perl -i.orig -pe 's/a/b/' scripts/start.ps1",
    "sed -i 's/a/b/' C:\\Users\\test\\repo\\scripts\\x.sh",
    "sed -i 's/a/b/' /c/Users/test/repo/.github/workflows/ci.yml",
    "git ls-files '*.ts' | xargs sed -i 's/a/b/'",
    "find packages -name '*.ts' -exec sed -i 's/a/b/' {} +",
  ]) {
    assert.ok(denied(c), c);
  }
});

test('the deny reason points at the Edit and Write tools', () => {
  const out = JSON.parse(run({ tool_input: { command: "sed -i 's/a/b/' src/x.ts" }, cwd: REPO_ROOT }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /Edit or Write tool/);
});

test('read-only and ordinary commands pass', () => {
  for (const c of [
    "sed -n '1,40p' packages/mcp-server/src/index.ts",
    "sed -n -e '10,20p' scripts/green.mjs",
    "sed 's/a/b/' scripts/green.mjs",
    'grep -rn "sed -i" .claude/hooks',
    'cat package.json',
    'git status --short',
    'git diff -- src/a.ts',
    'git log --oneline -5 -- docs/dev/ARCHITECTURE.md',
    'npm run green',
    'npm ci --silent',
    'gh pr view 357 --json files',
    'gh pr create --title "x" --body-file notes.md',
    'node scripts/green.mjs --list',
    'python --version',
    'ls -la',
    '',
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('writes outside the repo pass: scratchpad, TEMP, vault, home variables', () => {
  for (const c of [
    "sed -i 's/a/b/' C:/Users/chris/AppData/Local/Temp/claude/scratchpad/x.ts",
    "sed -i 's/a/b/' /c/Users/chris/Documents/Obsidian/vault/Dev/Foundry\\ AI\\ Tool/Backlog.md",
    "sed -i 's/a/b/' \"C:/Users/chris/Documents/Obsidian/vault/Dev/Foundry AI Tool/Backlog.md\"",
    "cat > \"C:/Users/chris/Documents/Obsidian/vault/Dev/Foundry AI Tool/Decisions/D-123.md\" <<'EOF'\nx\nEOF",
    "cat <<'EOF' | tee \"C:/Users/chris/Documents/Obsidian/vault/Dev/Foundry AI Tool/Waiting.md\"\nx\nEOF",
    "sed -i 's/a/b/' $TMPDIR/x.json",
    "sed -i 's/a/b/' ~/notes/x.md",
    "cat > C:/Users/chris/Documents/Obsidian/vault/Waiting.md <<'EOF'\nhello\nEOF",
    "cat > $env:TEMP/x.ts <<'EOF'\nhello\nEOF",
    "python - <<'EOF'\nopen(r'C:\\Users\\chris\\Documents\\Obsidian\\vault\\Backlog.md','w').write('x')\nEOF",
    "perl -pi -e 's/a/b/' C:/Users/chris/AppData/Local/Temp/x.mjs",
    "sed -i 's/a/b/' node_modules/pkg/index.js",
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('python -c and heredoc scripts that write a repo source file are denied', () => {
  const body = "p = 'packages/a/src/b.ts'\ns = open(p).read().replace('a', 'b')\nopen(p, 'w').write(s)";
  for (const c of [
    `python - <<'EOF'\n${body}\nEOF`,
    `python <<'PY'\n${body}\nPY`,
    `python3 - <<EOF\n${body}\nEOF`,
    `py -c "open('scripts/green.mjs','w').write('x')"`,
    `python -c "from pathlib import Path; Path('docs/a.md').write_text('x')"`,
    `python -c "import re; p='.claude/settings.json'; t=open(p).read(); open(p,'w').write(re.sub('a','b',t))"`,
    `python.exe -c "import os; os.replace('tmp.json', 'package.json'); open('x','w')"`,
    `node -e "require('fs').writeFileSync('packages/a/src/b.ts', 'x')"`,
    `node - <<'EOF'\nconst fs = require('fs');\nfs.writeFileSync('scripts/x.mjs', fs.readFileSync('scripts/x.mjs','utf8').replace(/a/g,'b'));\nEOF`,
    `cd packages/a && python -c "open('src/b.ts','w').write('x')"`,
  ]) {
    assert.ok(denied(c), c);
  }
});

test('python and node scripts that only read, or write outside the repo, pass', () => {
  for (const c of [
    `python -c "print(open('package.json').read())"`,
    `python -c "import sys; sys.stdout.write(open('package.json').read())"`,
    `python -c "import json; print(json.load(open('package.json'))['version'])"`,
    `python -c "open('C:/Users/chris/AppData/Local/Temp/out.txt','w').write(open('package.json').read())"`,
    `python - <<'EOF'\nimport json\nprint(json.load(open('package.json')))\nEOF`,
    `python - <<'EOF'\nopen('C:/Users/chris/AppData/Local/Temp/scratch.json','w').write(open('package.json').read())\nEOF`,
    `python scripts/dev/tool.py`,
    `python -c "print(1+1)"`,
    `node -e "console.log(require('./package.json').version)"`,
    `node -e "require('fs').writeFileSync(process.env.TEMP + '/x.txt', require('./package.json').name)"`,
    `node scripts/lane-merge.mjs 357 --dry-run`,
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('a heredoc, echo or printf redirected onto a repo source path is denied', () => {
  for (const c of [
    "cat > packages/a/src/b.ts <<'EOF'\nconst x = 1;\nEOF",
    "cat <<'EOF' > scripts/new.mjs\nconsole.log(1);\nEOF",
    "cat <<EOF >> docs/dev/ARCHITECTURE.md\nmore\nEOF",
    "tee .claude/settings.json <<'EOF'\n{}\nEOF",
    'cat <<-EOF > start.ps1\nWrite-Host hi\n\tEOF',
    "echo '{}' > package.json",
    'printf "%s" "x" >> CHANGELOG.md',
    "cat <<'EOF' | tee scripts/x.sh\nhi\nEOF",
    "@'\nWrite-Host hi\n'@ | Set-Content -Path scripts/new.ps1",
    "@'\nhello\n'@ > docs/a.md",
  ]) {
    assert.ok(denied(c), c);
  }
});

test('commit messages through a heredoc pass, even when the body talks about sed -i or redirects', () => {
  for (const c of [
    "git commit -F - <<'EOF'\nFix the guard\n\nBlocks `sed -i foo.ts` and cat > a.ts <<EOF.\nCo-Authored-By: Claude\nEOF",
    "git commit -m \"$(cat <<'EOF'\nUse > docs/a.md as the target\nEOF\n)\"",
    "gh pr create --title t --body-file - <<'EOF'\n## Summary\n- python -c \"open('a.ts','w')\"\nEOF",
    "git commit -F - <<'EOF'\nsubject\nEOF\ngit push -u aitool b:b",
    "git commit -m @'\nsed -i x.ts and Set-Content a.ts with -replace\n'@",
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('ordinary redirects of command output pass', () => {
  for (const c of [
    'npm run docs:tools > docs/out.txt',
    'node scripts/x.mjs > out.json 2>&1',
    'npm test 2>&1 | tail -20',
    'gh pr view 357 --json files > C:/Users/chris/AppData/Local/Temp/pr.json',
    'git diff > /tmp/x.md',
    'npm run build && echo done',
    "cat <<'EOF' > C:/Users/chris/AppData/Local/Temp/msg.md\nhi\nEOF",
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('PowerShell rewrites of repo source files are denied; plain use passes', () => {
  for (const c of [
    "(Get-Content scripts/start.ps1) -replace 'a','b' | Set-Content scripts/start.ps1",
    "(Get-Content 'docs/a.md' -Raw).Replace('a','b') | Out-File -FilePath docs/a.md",
    "[IO.File]::WriteAllText('C:\\Users\\test\\repo\\a.ts', (Get-Content a.ts -Raw).Replace('x','y'))",
    "@'\nline\n'@ | Set-Content -Path packages/a/src/b.ts",
  ]) {
    assert.ok(denied(c), c);
  }
  for (const c of [
    "Get-Content scripts/start.ps1 | Select-String 'x'",
    "(Get-Content scripts/start.ps1) -replace 'a','b' | Set-Content $env:TEMP\\start.ps1",
    "Set-Content -Path C:\\Users\\chris\\AppData\\Local\\Temp\\x.ts -Value 'x'",
    'Get-ChildItem -Recurse -Filter *.ts | Measure-Object',
    '$env:CI = "true"; npm run green',
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('relative paths resolve against the payload cwd', () => {
  // cwd inside the repo: denied. cwd outside the repo (the vault): allowed.
  assert.ok(decide("sed -i 's/a/b/' src/x.ts", CWD, ROOT) !== null);
  assert.ok(decide("sed -i 's/a/b/' x.md", 'C:\\Users\\chris\\Documents\\Obsidian\\vault', ROOT) === null);
  assert.ok(decide("sed -i 's/a/b/' ../repo/src/x.ts", 'C:\\Users\\test\\other', ROOT) !== null);
  assert.ok(decide("sed -i 's/a/b/' ../other/x.ts", 'C:\\Users\\test\\repo', ROOT) === null);
});

test('a leading cd moves relative paths: the vault claim step passes, a cd inside the repo still denies', () => {
  const vault = 'cd "C:/Users/chris/Documents/Obsidian/vault"';
  const claim = "p='Dev/Foundry AI Tool/Backlog.md'\ns=open(p,encoding='utf-8').read()\nopen(p,'w',encoding='utf-8').write(s)";
  assert.ok(allowed(`${vault} && python - <<'EOF'\n${claim}\nEOF`));
  assert.ok(allowed(`${vault} && sed -i 's/a/b/' Waiting.md`));
  assert.ok(allowed("Set-Location 'C:\\Users\\chris\\Documents\\Obsidian\\vault'; (Get-Content a.md) -replace 'a','b' | Set-Content a.md"));
  assert.ok(allowed("cd $VAULT && sed -i 's/a/b/' Waiting.md"));
  assert.ok(allowed("cd ~/notes && sed -i 's/a/b/' x.md"));
  assert.ok(denied("cd packages/a && sed -i 's/a/b/' src/x.ts"));
  assert.ok(denied("cd C:/Users/test/repo/scripts && sed -i 's/a/b/' x.mjs"));
  assert.ok(allowed("cd .. && sed -i 's/a/b/' x.md")); // one level above the repo
  assert.ok(denied(`cd "C:/Users/chris/Documents/Obsidian/vault" && sed -i 's/a/b/' "${ROOT}/src/x.ts"`));
});

test('isRepoSource: extensions, repo boundary, unresolvable paths', () => {
  assert.ok(isRepoSource('src/a.ts', CWD, ROOT));
  assert.ok(isRepoSource('"scripts\\a.PS1"', CWD, ROOT));
  assert.ok(!isRepoSource('src/a.png', CWD, ROOT));
  assert.ok(!isRepoSource('src/a.tsbuildinfo', CWD, ROOT));
  assert.ok(!isRepoSource('C:/Users/test/repo2/a.ts', CWD, ROOT));
  assert.ok(!isRepoSource('$HOME/a.ts', CWD, ROOT));
  assert.ok(!isRepoSource('%TEMP%\\a.ts', CWD, ROOT));
  assert.ok(!isRepoSource('node_modules/x/a.js', CWD, ROOT));
  assert.ok(!isRepoSource('.git/hooks/a.sh', CWD, ROOT));
});

test('pathTokens keeps quoted and escaped paths with spaces whole', () => {
  assert.deepEqual(pathTokens('sed -i s/a/b/ "x y/z.md"'), ['x y/z.md']);
  assert.deepEqual(pathTokens('cat a\\ b/c.ts'), ['a b/c.ts']);
  assert.deepEqual(pathTokens("sed -i 's/a/b.js/' src/x.ts"), ['src/x.ts']);
});

test('splitBodies separates heredoc and here-string bodies from the command', () => {
  const a = splitBodies("cat <<'EOF' > a.ts\nbody > b.ts\nEOF\necho after");
  assert.equal(a.bodies.length, 1);
  assert.equal(a.bodies[0].body, 'body > b.ts');
  assert.ok(!a.outer.includes('body'));
  assert.ok(a.outer.includes('echo after'));
  const b = splitBodies("x = @'\nline\n'@ | Set-Content a.ts");
  assert.equal(b.bodies[0].kind, 'herestring');
});

test('the hook entry point: stdin payload in, deny JSON or nothing out, junk allowed', () => {
  const go = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const repoFile = path.resolve(path.dirname(HOOK), '..', '..', 'package.json');
  const bad = go(JSON.stringify({ tool_input: { command: `sed -i 's/a/b/' ${repoFile}` } }));
  assert.equal(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(go(JSON.stringify({ tool_input: { command: 'git status' } })).stdout, '');
  assert.equal(go('not json').stdout, '');
  assert.equal(go('').stdout, '');
  assert.equal(go(JSON.stringify({ tool_input: {} })).stdout, '');
});
