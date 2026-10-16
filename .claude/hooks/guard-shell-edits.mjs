#!/usr/bin/env node
// PreToolUse guard for Bash and PowerShell (Claude Code hook): no shell edits of repo source files.
//
// Python, sed and heredoc edits of source files repeatedly lost backslashes, wrote backspace bytes
// into regexes or dropped test assertions (insights report 2026-10-16: PR #348's TrimEnd, the board
// regex). The Edit and Write tools do not mangle text, so this hook refuses a shell command that
// rewrites a repo file with one of these extensions and says to use them instead:
//   .ts .tsx .js .mjs .ps1 .sh .json .yml .md
//
// Denied (only when the target resolves inside this repo):
//   - `sed -i` / `perl -i` (also behind xargs or find -exec) on a source file
//   - a python or node `-c` / `-e` / heredoc script that writes a source file
//   - a heredoc or here-string written onto a source path (`cat > f.ts <<EOF`, `tee f.ts <<EOF`,
//     `@'...'@ | Set-Content f.ts`), `echo`/`printf` redirected onto one, and PowerShell
//     Set-Content/Out-File/Add-Content/WriteAllText with `-replace`/`.Replace(`/a here-string
// Always allowed: read-only use (`sed -n`, grep, cat, git, npm, gh), commit messages through
// `git commit -F - <<'EOF'` (heredoc bodies are data, not commands), and anything that writes
// outside the repo (scratchpad, %TEMP%, the vault) or through a variable path it cannot resolve.
//
// A false deny stops every lane, so every doubt allows: unparseable payloads, `$VAR` or `~` paths,
// scripts run from a file. Reads the hook payload (JSON) on stdin; prints a deny decision or nothing.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_EXT = 'json|tsx|ts|mjs|js|ps1|sh|yml|md';
const PATH_TOKEN = new RegExp(
  `[^\\s"'=;|&<>()\`,]+\\.(?:${SOURCE_EXT})(?=$|[\\s"'\`;|&)<>,\\]])`,
  'gi'
);
const DENY_SUFFIX = ' Use the Edit or Write tool for source files (they do not mangle backslashes or escapes).';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

// --- paths -----------------------------------------------------------------------------------

function normalize(p) {
  let s = String(p).replace(/\\/g, '/');
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(s); // git-bash /c/Users/...
  if (m) s = `${m[1]}:/${m[2]}`;
  return s;
}

/** True when `token` is a source file inside `repoRoot` (relative tokens resolve against `cwd`). */
export function isRepoSource(token, cwd, repoRoot = REPO_ROOT) {
  let t = String(token).replace(/^["'`]+|["'`]+$/g, '');
  if (!t || /^[$~%]/.test(t) || /\$|%[A-Za-z_]+%/.test(t)) return false; // unresolvable
  if (!new RegExp(`\\.(?:${SOURCE_EXT})$`, 'i').test(t)) return false;
  t = normalize(t);
  const root = normalize(repoRoot).replace(/\/+$/, '');
  const absolute = /^([a-zA-Z]:)?\//.test(t);
  if (cwd === null && !absolute) return false; // after a `cd` we cannot resolve
  const base = cwd ? normalize(cwd) : root;
  const abs = absolute ? path.posix.normalize(t) : path.posix.normalize(`${base}/${t}`);
  const a = abs.toLowerCase();
  const r = root.toLowerCase();
  if (!(a === r || a.startsWith(`${r}/`))) return false;
  return !/\/(node_modules|\.git)\//.test(a);
}

const QUOTED_PATH = new RegExp(`(["'])([^"'\\n]*\\.(?:${SOURCE_EXT}))\\1`, 'gi');

/** Source-looking path tokens; quoted paths and `\ ` escapes may contain spaces ("Foundry AI Tool"). */
export function pathTokens(text) {
  const found = [];
  const rest = String(text)
    .replace(QUOTED_PATH, (_m, _q, inner) => {
      found.push(inner);
      return ' ';
    })
    .replace(/\\ /g, '\u0001');
  for (const t of rest.match(PATH_TOKEN) ?? []) found.push(t.replace(/\u0001/g, ' '));
  return found;
}

function repoSources(text, cwd, repoRoot) {
  return pathTokens(text).filter(t => isRepoSource(t, cwd, repoRoot));
}

function cwdInRepo(cwd, repoRoot) {
  if (!cwd) return false;
  const c = normalize(cwd).toLowerCase().replace(/\/+$/, '');
  const r = normalize(repoRoot).toLowerCase().replace(/\/+$/, '');
  return c === r || c.startsWith(`${r}/`);
}

// --- command parsing -------------------------------------------------------------------------

/**
 * Split heredoc (`<<'EOF'`) and PowerShell here-string (`@'`...`'@`) bodies off the command.
 * `outer` is the command with the bodies removed; `bodies` keeps each body with its introducing line.
 */
export function splitBodies(command) {
  const lines = String(command).split(/\r?\n/);
  const outer = [];
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    outer.push(line);
    const doc = /<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line);
    const hs = /@(['"])\s*$/.exec(line);
    const end = doc ? doc[2] : null;
    if (!doc && !hs) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (doc ? l.trim() === end : l.startsWith(`${hs[1]}@`)) break;
      body.push(l);
    }
    bodies.push({ intro: line, body: body.join('\n'), kind: doc ? 'heredoc' : 'herestring' });
    if (hs && j < lines.length) outer.push(lines[j]); // keep the closing `'@` (a pipeline may follow)
    i = j;
  }
  return { outer: outer.join('\n'), bodies };
}

const CMD_START = String.raw`(?:^|[;&|(\n\`]|\$\(|\bxargs\s+(?:-\S+\s+)*|-exec(?:dir)?\s+)\s*(?:(?:sudo|env|command|time)\s+)*(?:\S*[\\/])?`;

function inPlaceTargets(outer, tool, flagRe) {
  // Every `tool ...` invocation in command position, up to the next ; & | or newline.
  const re = new RegExp(`${CMD_START}${tool}(?:\\.exe)?(?=\\s)([^;&|\\n]*)`, 'g');
  const hits = [];
  for (const m of outer.matchAll(re)) {
    const args = m[1];
    if (flagRe.test(args)) hits.push({ args, viaXargs: /xargs|-exec/.test(m[0]) });
  }
  return hits;
}

const SED_INPLACE = /(?:^|\s)(?:-[nEesrzub]*i\S*|--in-place(?:=\S*)?)(?=\s|$)/;
const PERL_INPLACE = /(?:^|\s)-[plnaws0-9]*i[A-Za-z.]*(?=\s|$)/;

function checkInPlace(outer, cwd, repoRoot) {
  for (const [tool, flagRe] of [
    ['sed', SED_INPLACE],
    ['perl', PERL_INPLACE],
  ]) {
    for (const hit of inPlaceTargets(outer, tool, flagRe)) {
      if (repoSources(hit.args, cwd, repoRoot).length > 0) {
        return `\`${tool} -i\` rewrites a repo source file in place.${DENY_SUFFIX}`;
      }
      if (hit.viaXargs && cwdInRepo(cwd, repoRoot)) {
        return `\`${tool} -i\` over a file list (xargs or find -exec) rewrites repo files in place.${DENY_SUFFIX}`;
      }
    }
  }
  return null;
}

// --- scripts (python, node) ------------------------------------------------------------------

const PY_CMD = new RegExp(`${CMD_START}(?:py|python\\d*(?:\\.\\d+)?)(?:\\.exe)?(?=\\s)([^;&|\\n]*)`, 'g');
const NODE_CMD = new RegExp(`${CMD_START}node(?:\\.exe)?(?=\\s)([^;&|\\n]*)`, 'g');
const PY_WRITE = /\.write\(|\.write_text\(|\.write_bytes\(|\bwritelines\(|os\.(?:replace|rename)\(|shutil\.(?:copy|copyfile|move)/;
const PY_OPEN_WRITE = /open\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"\n]*)\3/g;
const PY_PATH_WRITE = /Path\(\s*(['"])([^'"\n]+)\1\s*\)\s*\.write_(?:text|bytes)\(/g;
const NODE_WRITE = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|copyFileSync)\s*\(/;

function scriptTexts(outer, bodies, re, inlineFlag) {
  const texts = [];
  for (const m of outer.matchAll(re)) {
    const args = m[1];
    if (inlineFlag.test(args)) texts.push(outer); // inline script: the quoted text is part of the command
  }
  // script on stdin: the heredoc body that a python or node line introduces
  for (const b of bodies) {
    if (b.kind === 'heredoc' && [...b.intro.matchAll(re)].some(m => /<</.test(m[1]))) texts.push(b.body);
  }
  return texts;
}

function pythonWritesRepo(rawText, cwd, repoRoot) {
  const text = rawText.replace(/sys\.std(?:out|err)\.write\(/g, '');
  if (!PY_WRITE.test(text) && !/open\([^)]*['"][wax+]/.test(text)) return false;
  const targets = [];
  for (const m of text.matchAll(PY_OPEN_WRITE)) if (/[wax+]/.test(m[4])) targets.push(m[2]);
  for (const m of text.matchAll(PY_PATH_WRITE)) targets.push(m[2]);
  const literalWrite = targets.length > 0;
  if (literalWrite && targets.some(t => isRepoSource(t, cwd, repoRoot))) return true;
  // A write through a variable or a read-then-write helper: only a repo source literal in the
  // script suggests the target (writes to literal temp paths alone do not).
  const onlyLiteralWrites = literalWrite && !/\.write_(?:text|bytes)\(|os\.(?:replace|rename)|shutil\./.test(text.replace(PY_PATH_WRITE, ''));
  if (onlyLiteralWrites) return false;
  return repoSources(text, cwd, repoRoot).length > 0;
}

const NODE_WRITE_CALL = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|copyFileSync)\s*\(\s*(['"`])?([^'"`\n]*)/g;
const NODE_READ_LITERAL = /\b(?:require|readFileSync|readFile|existsSync|statSync)\s*\(\s*(['"`])[^'"`\n]+\1/g;

function nodeWritesRepo(text, cwd, repoRoot) {
  if (!NODE_WRITE.test(text)) return false;
  const calls = [...text.matchAll(NODE_WRITE_CALL)];
  const literal = calls.filter(c => c[1]).map(c => c[2]);
  if (literal.some(t => isRepoSource(t, cwd, repoRoot))) return true;
  if (literal.length === calls.length) return false; // every write goes to a literal outside the repo
  // A write through a variable: a repo source literal that is not just read suggests the target.
  return repoSources(text.replace(NODE_READ_LITERAL, ' '), cwd, repoRoot).length > 0;
}

function checkScripts(outer, bodies, cwd, repoRoot) {
  for (const t of scriptTexts(outer, bodies, PY_CMD, /(?:^|\s)-[A-Za-z]*c(?=\s|$|["'])/)) {
    if (pythonWritesRepo(t, cwd, repoRoot)) return `A python script writes a repo source file.${DENY_SUFFIX}`;
  }
  for (const t of scriptTexts(outer, bodies, NODE_CMD, /(?:^|\s)(?:-e|--eval|-p|--print)(?=\s|$|["'])/)) {
    if (nodeWritesRepo(t, cwd, repoRoot)) return `A node script writes a repo source file.${DENY_SUFFIX}`;
  }
  return null;
}

// --- redirects and PowerShell writes ---------------------------------------------------------

const REDIRECT = /(?:^|[^0-9&>|<=\-])>>?\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s"';&|)<>]+))/g;
const redirectPath = m => m[1] ?? m[2] ?? m[3];
const TEE = new RegExp(`${CMD_START}tee(?:\\.exe)?(?=\\s)([^;&|\\n]*)`, 'g');
const ECHOISH = new RegExp(`${CMD_START}(?:echo|printf)(?=\\s)([^;&|\\n]*)`, 'g');
const PS_WRITER = /\b(?:Set-Content|Add-Content|Out-File|WriteAllText|WriteAllLines|WriteAllBytes)\b/i;
const PS_MANGLE = /(?:-replace\b|\.Replace\(|@['"])/i;

function redirectTargets(outer) {
  const targets = [];
  for (const m of outer.matchAll(REDIRECT)) targets.push(redirectPath(m));
  for (const m of outer.matchAll(TEE)) targets.push(...pathTokens(m[1]));
  return targets;
}

function checkRedirects(command, outer, bodies, cwd, repoRoot) {
  const hasDoc = bodies.length > 0 || /<</.test(outer);
  const isRepo = t => isRepoSource(t, cwd, repoRoot);
  const targets = hasDoc ? redirectTargets(outer).filter(isRepo) : [];
  for (const m of outer.matchAll(ECHOISH)) {
    targets.push(...[...m[1].matchAll(REDIRECT)].map(redirectPath).filter(isRepo));
  }
  if (targets.length > 0) {
    return `A heredoc, echo or printf is written onto the repo source file ${targets[0]}.${DENY_SUFFIX}`;
  }
  if (PS_MANGLE.test(command)) {
    const writer = [];
    for (const line of outer.split('\n')) {
      const w = PS_WRITER.exec(line);
      if (w) writer.push(...repoSources(line.slice(w.index), cwd, repoRoot));
    }
    if (writer.length > 0) return `A PowerShell write (Set-Content, Out-File, WriteAllText) rewrites the repo source file ${writer[0]}.${DENY_SUFFIX}`;
  }
  return null;
}

// --- decision --------------------------------------------------------------------------------

const CD_CMD = new RegExp(
  `${CMD_START}(?:cd|pushd|Set-Location|sl)(?=\\s)\\s+(?:-\\S+\\s+)*(?:"([^"\\n]+)"|'([^'\\n]+)'|([^\\s;&|]+))`,
  'gi'
);

/** Working directory after the command's `cd` segments (the last one wins); null when unresolvable. */
export function effectiveCwd(outer, cwd) {
  let cur = cwd;
  for (const m of outer.matchAll(CD_CMD)) {
    const dir = m[1] ?? m[2] ?? m[3];
    if (!dir || /^[$~%-]|\$|%[A-Za-z_]+%/.test(dir)) return null;
    const d = normalize(dir.replace(/\\ /g, ' '));
    if (/^([a-zA-Z]:)?\//.test(d)) cur = d;
    else if (cur === null) return null;
    else cur = path.posix.normalize(`${cur ? normalize(cur) : normalize(REPO_ROOT)}/${d}`);
  }
  return cur;
}

/** Returns the deny reason, or null to allow. Never throws. */
export function decide(command, startCwd = '', repoRoot = REPO_ROOT) {
  try {
    const text = String(command ?? '');
    if (!text.trim()) return null;
    const { outer, bodies } = splitBodies(text);
    const cwd = effectiveCwd(outer, startCwd);
    return (
      checkInPlace(outer, cwd, repoRoot) ??
      checkScripts(outer, bodies, cwd, repoRoot) ??
      checkRedirects(text, outer, bodies, cwd, repoRoot)
    );
  } catch {
    return null;
  }
}

export function run(input) {
  try {
    const command = String(input?.tool_input?.command ?? '');
    const reason = decide(command, input?.cwd ?? '');
    if (!reason) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked by .claude/hooks/guard-shell-edits.mjs: ${reason}`,
      },
    });
  } catch {
    return '';
  }
}

function main() {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return; // not a payload we understand: allow
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main();
}
