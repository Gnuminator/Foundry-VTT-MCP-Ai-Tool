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

const VAULT_BACKLOG = String.raw`C:\Users\chris\Documents\Obsidian\vault\Dev\Foundry AI Tool\Backlog.md`;

test('M1: python and node writes to the vault or TEMP pass even when repo paths appear in the script', () => {
  for (const c of [
    // the planner's Backlog claim: Path(r'...') with repo paths in the replaced text
    `python - <<'EOF'\nfrom pathlib import Path\np = Path(r'${VAULT_BACKLOG}')\nt = p.read_text(encoding='utf-8')\nt = t.replace('- claimed: none', '- claimed: x; files: scripts/green.mjs')\np.write_text(t, encoding='utf-8')\nEOF`,
    // a variable assigned an r'...' path, then open(p, 'w')
    `python - <<'EOF'\np = r'${VAULT_BACKLOG}'\nt = open(p, encoding='utf-8').read()\nt = t.replace('a', 'scripts/green.mjs')\nopen(p, 'w', encoding='utf-8').write(t)\nEOF`,
    // dump a repo file to TEMP
    String.raw`python - <<'EOF'
with open(r'C:\Users\chris\AppData\Local\Temp\out.md', 'w') as f:
    f.write(open('docs/dev/ARCHITECTURE.md').read())
EOF`,
    `python -c "import json,os,tempfile; d=json.load(open('package.json')); open(os.path.join(tempfile.gettempdir(),'x.json'),'w').write(json.dumps(d))"`,
    `node -e "const fs=require('fs'),path=require('path'),os=require('os'); const out=path.join(os.tmpdir(),'x.json'); fs.writeFileSync(out, fs.readFileSync(path.join('packages','shared','package.json')))"`,
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('M1: a repo target held in a variable or Path() is still found', () => {
  for (const c of [
    `python - <<'PY'\nfrom pathlib import Path\np = Path('packages/a/src/b.ts')\np.write_text(p.read_text().replace('a','b'))\nPY`,
    `python - <<'PY'\nfrom pathlib import Path\nPath(r'scripts\\green.mjs').write_text('x')\nPY`,
    `python - <<'PY'\np = r'scripts\\green.mjs'\nopen(p, 'w').write('x')\nPY`,
    `node -e "const f='scripts/x.mjs'; require('fs').writeFileSync(f, 'x')"`,
  ]) {
    assert.ok(denied(c), c);
  }
});

test('M2: sed -i is found when its script holds ; or |, and quoted message text is not a command', () => {
  for (const c of [
    "sed -i 's/a/b/; s/c/d/' scripts/green.mjs",
    'sed -i "s/a/b/;s/c/d/" packages/shared/src/a.ts',
    "sed -i 's|a|b|' scripts/green.mjs",
  ]) {
    assert.ok(denied(c), c);
  }
  for (const c of [
    'git commit -m "Guard: deny (sed -i on a.ts) edits"',
    "git commit -m 'Deny `sed -i x.ts` in hooks'",
    'git commit -m "subject\n\nsed -i scripts/green.mjs is now blocked"',
    'git commit -m "python -c \\"open(\'a.ts\',\'w\')\\" is blocked"',
  ]) {
    assert.ok(allowed(c), c);
  }
});

test('M3: a PowerShell writer is read only up to the next ; or |', () => {
  for (const c of [
    "$r = (Get-Content CHANGELOG.md -Raw) -replace \"`r\",''; $r | Out-File $env:TEMP\\c.md; git diff -- CHANGELOG.md",
    "git log -1 --format=%B | Out-File $env:TEMP\\msg.txt; (Get-Content package.json -Raw) -replace 'x','y' | Measure-Object",
  ]) {
    assert.ok(allowed(c), c);
  }
  assert.ok(denied("(Get-Content CHANGELOG.md -Raw) -replace 'a','b' | Set-Content CHANGELOG.md; git diff"));
  assert.ok(denied('(Get-Content CHANGELOG.md) -replace "a","b;c" | Set-Content CHANGELOG.md'));
});

test('M4: a 100 KB single token or minified command is answered fast (and over the cap, unread)', () => {
  const slow = [
    'a'.repeat(99_000),
    `sed -i ${'a.a'.repeat(33_000)}`,
    `node -e "${'f(a,b);'.repeat(14_000)}"`,
    `python -c "${'a.b(c);'.repeat(14_000)}"`,
    `python -c "${'open('.repeat(15_000)}"`,
    `sed ${'/x'.repeat(49_000)}`,
    `${'a'.repeat(200_000)}`,
    `python - <<'EOF'\n${"open(p,'w')\n".repeat(7_500)}EOF`,
    `${'-replace Set-Content a b c d e f g h '.repeat(2_600)}`,
    `-replace x; ${'Out-File '.repeat(11_000)}`,
  ];
  for (const c of slow) {
    const t = Date.now();
    assert.equal(decide(c, CWD, ROOT), null);
    assert.ok(Date.now() - t < 500, `${c.slice(0, 20)}... took ${Date.now() - t} ms`);
  }
});

test('L2: a redirect on a later line belongs to that command, not to the heredoc before it', () => {
  assert.ok(allowed("git commit -F - <<'EOF'\nmsg\nEOF\nnpm run docs:tools > docs/dev/tools.md"));
  assert.ok(denied("git commit -F - <<'EOF'\nmsg\nEOF\ncat > docs/dev/a.md <<'EOF'\nx\nEOF"));
});

test('L3: <<\\EOF bodies are data; Push-Location moves the working directory', () => {
  assert.ok(allowed("cat <<\\EOF\nsed -i 's/a/b/' scripts/green.mjs\nEOF"));
  assert.ok(
    allowed(
      "Push-Location 'C:\\Users\\chris\\Documents\\Obsidian\\vault'; (Get-Content Waiting.md) -replace 'a','b' | Set-Content Waiting.md"
    )
  );
});

test('an empty working directory falls back to the repo root passed in', () => {
  assert.ok(decide("cd packages && sed -i 's/a/b/' src/x.ts", '', ROOT) !== null);
  assert.ok(decide("sed -i 's/a/b/' src/x.ts", '', ROOT) !== null);
});

const VAULT = 'C:\\Users\\chris\\Documents\\Obsidian\\vault';

test('round 2 M1: an unknown write target allows; only a loop variable falls back to its literals', () => {
  for (const c of [
    // vault edit with replacement text in variables
    `python - <<'EOF'\nimport os\np = os.path.join(VAULT, 'Dev', 'Foundry AI Tool', 'Backlog.md')\nold = '- files: none'\nnew = '- files: scripts/green.mjs'\nt = open(p).read().replace(old, new)\nopen(p, 'w', encoding='utf-8').write(t)\nEOF`,
    `python - <<'EOF'\nline = 'see changelog.d/edit-guard.md'\nopen(os.path.join(VAULT, 'Waiting.md'), 'a').write(line)\nEOF`,
    // read repo files, write to TEMP
    `python - <<'EOF'\nimport os, tempfile\nout = os.path.join(tempfile.gettempdir(), 'dump.txt')\nwith open(out, 'w') as o:\n    for f in ['package.json', 'docs/dev/ARCHITECTURE.md']:\n        o.write(open(f).read())\nEOF`,
    `python - <<'EOF'\nfrom pathlib import Path\nimport os, glob\nfor f in glob.glob('docs/**/*.md'):\n    (Path(os.environ['TEMP']) / 'x.txt').write_text(open(f).read())\nEOF`,
    `python - <<'EOF'\nimport shutil, os, tempfile\nsrc = 'package.json'\nshutil.copy(src, os.path.join(tempfile.gettempdir(), 'p.json'))\nEOF`,
    `node -e "const f='package.json'; const out=path.join(os.tmpdir(),'x.json'); fs.writeFileSync(out, fs.readFileSync(f))"`,
    // a script that writes nothing: `.open(` that is not a file mode
    `python - <<'EOF'\nf = 'docs/dev/ARCHITECTURE.md'\nprint(open(f).read()[:100])\nwebbrowser.open('http://localhost:3100')\nImage.open('a.png')\nEOF`,
  ]) {
    assert.ok(allowed(c), c);
  }
  for (const c of [
    `python - <<'PY'\nfor f in ['scripts/a.mjs', 'scripts/b.mjs']:\n    open(f, 'w').write('x')\nPY`,
    `python - <<'PY'\nimport glob\nfor f in glob.glob('docs/*.md'):\n    open(f, 'w').write('x')\nPY`,
    `node -e "for (const f of ['scripts/a.mjs']) { require('fs').writeFileSync(f, 'x'); }"`,
    `python - <<'PY'\nimport os\nopen(os.path.join('scripts', 'green.mjs'), 'w').write('x')\nPY`,
    `python - <<'PY'\nimport os\nx = r'C:/Users/test/repo'\nopen(os.path.join(x, 'a.ts'), 'w').write('x')\nPY`,
    `node -e "fs.writeFileSync(path.join('packages','a','b.ts'), 'x')"`,
  ]) {
    assert.ok(denied(c), c);
  }
});

test('round 2 L1 (lows): a loop variable name that is reused for something else does not fall back to the loop', () => {
  for (const c of [
    `python - <<'PY'\nfor f in ['package.json']:\n    print(open(f).read())\nf = os.path.join(tempfile.gettempdir(), 'x.txt')\nopen(f, 'w').write('x')\nPY`,
    `node -e "for (const f of ['package.json']) { console.log(fs.readFileSync(f)); } const g = 1; let f = path.join(os.tmpdir(), 'x.txt'); fs.writeFileSync(f, 'x')"`,
  ]) {
    assert.ok(allowed(c), c);
  }
  // an unreused name still falls back to the loop's literals, and a comparison or lambda is not a reuse
  for (const c of [
    `python - <<'PY'\nfor f in ['scripts/a.mjs']:\n    if f == 'x': pass\n    open(f, 'w').write('x')\nPY`,
    `node -e "for (const f of ['scripts/a.mjs']) { [1].map(x => f); fs.writeFileSync(f, 'x'); }"`,
    // #366 L1: an assignment from the same variable is not a reuse
    `python - <<'PY'\nfor p in ['scripts/a.mjs']:\n    p = Path(p)\n    open(p, 'w').write('x')\nPY`,
    `node -e "for (const f of ['scripts/a.mjs']) { f = f.trim(); fs.writeFileSync(f, 'x'); }"`,
  ]) {
    assert.ok(denied(c), c);
  }
});

test('round 2 L2 (lows): a heredoc redirect target is placed where it stands, not at the end of its line', () => {
  const at = (cmd, cwd) => decide(cmd, cwd, ROOT);
  // the session is in the vault; the cd back to the repo comes after the redirect on the same line
  assert.equal(at(`cat >> Waiting.md <<'EOF' && cd "${CWD}"\nx\nEOF`, VAULT), null);
  assert.equal(at(`cat >> Waiting.md <<'EOF' | tee Backlog.md && cd "${CWD}"\nx\nEOF`, VAULT), null);
  // a cd before the redirect on the same line still counts, in both directions
  assert.notEqual(at(`cd "${CWD}" && cat >> scripts/x.mjs <<'EOF'\nx\nEOF`, VAULT), null);
  assert.equal(at(`cd "${VAULT}" && cat >> Waiting.md <<'EOF'\nx\nEOF`, CWD), null);
  // a repo path stays denied wherever the cd sits
  assert.notEqual(at(`cat >> scripts/x.mjs <<'EOF' && cd "${VAULT}"\nx\nEOF`, CWD), null);
});

test('round 2 M2: the working directory is the one before the write, not the last cd in the command', () => {
  for (const c of [
    `cd "${VAULT}" && sed -i 's/a/b/' Waiting.md && git commit -am x && cd "${CWD}"`,
    `Set-Location '${VAULT}'; (Get-Content Waiting.md) -replace 'a','b' | Set-Content Waiting.md; Set-Location '${CWD}'`,
    `pushd "${VAULT}" && sed -i 's/a/b/' Waiting.md && popd`,
  ]) {
    assert.ok(allowed(c), c);
  }
  assert.ok(denied(`cd "${VAULT}" && cd "${CWD}" && sed -i 's/a/b/' scripts/x.mjs`));
  assert.ok(denied(`sed -i 's/a/b/' scripts/x.mjs; cd /tmp`));
  assert.ok(denied(`cd "${VAULT}" && sed -i 's/a/b/' w.md; cd "${CWD}" && sed -i 's/a/b/' scripts/x.mjs`));
  // a heredoc on the same line as the cd
  assert.ok(allowed(`cd "${VAULT}" && cat > Waiting.md <<'EOF'\nx\nEOF`));
});

test('round 2 L1: an apostrophe in a # comment does not open a quote', () => {
  assert.ok(allowed("# Don't push yet\ngit commit -m 'Guard: deny; sed -i x.ts edits'"));
  assert.ok(
    allowed(`# Don't touch the live ports\nSet-Location '${VAULT}'\n(Get-Content Waiting.md) -replace 'a','b' | Set-Content Waiting.md`)
  );
  assert.ok(denied("# don't\nsed -i 's/a/b/' scripts/green.mjs"));
  assert.ok(denied("sed -i 's/a/b/' scripts/green.mjs # it's fine"));
  assert.ok(allowed("echo 'a # b' && git status"));
});

test('round 2 L2: find over a directory outside the repo is not a repo rewrite', () => {
  assert.ok(allowed(`find "${VAULT}" -name '*.md' -exec sed -i 's/a/b/' {} +`));
  assert.ok(denied("find packages -name '*.ts' -exec sed -i 's/a/b/' {} +"));
  assert.ok(denied("find . -name '*.ts' -exec sed -i 's/a/b/' {} +"));
});

test('round 2 L4: every PowerShell writer on a line is checked; endless cd chains are not analysed', () => {
  assert.ok(
    denied("'x' | Out-File $env:TEMP\\a.txt; (Get-Content CHANGELOG.md) -replace 'a','b' | Set-Content CHANGELOG.md")
  );
  const t = Date.now();
  assert.equal(decide(`${'cd a;'.repeat(19_000)} sed -i 's/a/b/' x.ts`, CWD, ROOT), null);
  assert.ok(Date.now() - t < 500, `cd chain took ${Date.now() - t} ms`);
});

test('the hook entry point: stdin payload in, deny JSON or nothing out, junk allowed', () => {
  const go = input => spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const repoFile = path.resolve(path.dirname(HOOK), '..', '..', 'package.json');
  const bad = go(JSON.stringify({ tool_input: { command: `sed -i 's/a/b/' "${repoFile}"` } }));
  assert.equal(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(go(JSON.stringify({ tool_input: { command: 'git status' } })).stdout, '');
  assert.equal(go('not json').stdout, '');
  assert.equal(go('').stdout, '');
  assert.equal(go(JSON.stringify({ tool_input: {} })).stdout, '');
});
