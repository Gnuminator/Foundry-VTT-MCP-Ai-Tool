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
//   - a python or node `-c` / `-e` / heredoc script whose write target is a repo source file
//   - a heredoc or here-string written onto a source path (`cat > f.ts <<EOF`, `tee f.ts <<EOF`,
//     `@'...'@ | Set-Content f.ts`), `echo`/`printf` redirected onto one, and PowerShell
//     Set-Content/Out-File/Add-Content/WriteAllText with `-replace`/`.Replace(`/a here-string
// Always allowed: read-only use (`sed -n`, grep, cat, git, npm, gh), commit messages through
// `git commit -F - <<'EOF'` (heredoc bodies are data, not commands), quoted text (a commit message
// that mentions `sed -i`), and anything that writes outside the repo (scratchpad, %TEMP%, the vault)
// or through a path it cannot resolve.
//
// A false deny stops every lane, so every doubt allows: unparseable payloads, `$VAR` or `~` paths,
// scripts run from a file (`python fix.py`), `bash -c "..."`, commands over 100 KB, a python or node
// write whose target is not a literal (`os.path.join(tempfile.gettempdir(), ...)`; only a loop
// variable over literals is followed). Quoted spans and `#` comments are masked before command words
// are looked for, so quotes hide text from the command patterns. The working directory is tracked
// per position: only the `cd`/`pushd`/`Push-Location`/`Set-Location` before a write count (a `popd`
// or more than 50 directory changes make it unknown).
// Reads the hook payload (JSON) on stdin; prints a deny decision or nothing.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_EXT = 'json|tsx|ts|mjs|js|ps1|sh|yml|md';
const EXT_END = new RegExp(`\\.(?:${SOURCE_EXT})$`, 'i');
const DENY_SUFFIX = ' Use the Edit or Write tool for source files (they do not mangle backslashes or escapes).';
const MAX_ANALYZE = 100_000; // longer commands are allowed unread (keeps the regexes cheap)
const MAX_TOKEN = 1024;

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
  if (!t || t.length > MAX_TOKEN || /^[$~%]/.test(t) || /\$|%[A-Za-z_]+%/.test(t)) return false; // unresolvable
  if (!EXT_END.test(t)) return false;
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
const TOKEN_SPLIT = /[\s"'=;|&<>()`,]+/;

/** Source-looking path tokens; quoted paths and `\ ` escapes may contain spaces ("Foundry AI Tool"). */
export function pathTokens(text) {
  const found = [];
  const rest = String(text)
    .replace(QUOTED_PATH, (_m, _q, inner) => {
      found.push(inner);
      return ' ';
    })
    .replace(/\\ /g, '\u0001');
  for (const t of rest.split(TOKEN_SPLIT)) {
    if (t.length > MAX_TOKEN) continue;
    const clean = t.replace(/[\]}]+$/, '');
    if (EXT_END.test(clean)) found.push(clean.replace(/\u0001/g, ' '));
  }
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
 * `outer` is the command with the bodies removed; each body keeps its introducing line and, for a
 * here-string, the closing line (a pipeline may follow `'@`).
 */
export function splitBodies(command) {
  const lines = String(command).split(/\r?\n/);
  const outer = [];
  const bodies = [];
  let len = 0; // length of `outer` so far, newlines included: the offset of the next line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = len + line.length; // end of the introducing line: a `cd` earlier on it has already run
    outer.push(line);
    len += line.length + 1;
    const doc = /<<(?!<)-?\s*\\?(['"]?)([A-Za-z_][\w-]*)\1/.exec(line);
    const hs = /@(['"])\s*$/.exec(line);
    if (!doc && !hs) continue;
    const end = doc ? doc[2] : null;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (doc ? l.trim() === end : l.startsWith(`${hs[1]}@`)) break;
      body.push(l);
    }
    const closing = hs && j < lines.length ? lines[j] : undefined;
    bodies.push({ intro: line, body: body.join('\n'), kind: doc ? 'heredoc' : 'herestring', closing, at });
    if (closing !== undefined) {
      outer.push(closing);
      len += closing.length + 1;
    }
    i = j;
  }
  return { outer: outer.join('\n'), bodies };
}

/**
 * Same-length copy of `s` with the inside of '...' and "..." spans replaced by `_`. A `#` that starts
 * a word outside quotes is a comment: the rest of its line is masked too (an apostrophe in
 * `# Don't push` must not open a quote).
 */
export function maskQuotes(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      let j = s.indexOf('\n', i);
      if (j < 0) j = s.length;
      out += '_'.repeat(j - i);
      i = j;
      continue;
    }
    if (c !== "'" && c !== '"') {
      out += c;
      i++;
      continue;
    }
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += c === '"' && s[j] === '\\' ? 2 : 1;
    if (j >= s.length) {
      out += s.slice(i); // unclosed quote: leave it readable
      break;
    }
    out += c + '_'.repeat(j - i - 1) + c;
    i = j + 1;
  }
  return out;
}

/** Match `re` (flags gd) on the masked text; capture groups come back from the original text. */
function scan(re, orig, masked) {
  const res = [];
  for (const m of masked.matchAll(re)) {
    const groups = (m.indices ?? []).slice(1).map(ix => (ix ? orig.slice(ix[0], ix[1]) : undefined));
    res.push({ whole: m[0], args: groups, margs: m.slice(1), index: m.index });
  }
  return res;
}

// Command position: start, after ; & | ( ` or a newline, or behind xargs / find -exec; optional
// sudo/env prefixes and a directory part (bounded, so one long token cannot make the match slow).
const CMD_START = String.raw`(?:^|[;&|(\n\`]|\$\(|\bxargs\s+(?:-\S{1,40}\s+){0,6}|-exec(?:dir)?\s+)\s*(?:(?:sudo|env|command|time)\s+){0,3}(?:[^\s;&|()\`]{0,200}[\\/])?`;
const cmdRe = (name, tail) => new RegExp(`${CMD_START}${name}${tail}`, 'gd');

const SED_INPLACE = /(?:^|\s)(?:-[nEesrzub]*i\S*|--in-place(?:=\S*)?)(?=\s|$)/;
const PERL_INPLACE = /(?:^|\s)-[plnaws0-9]*i[A-Za-z.]*(?=\s|$)/;

/** Directory a `find ... -exec` before `index` searches, or undefined when it cannot be read. */
function findDir(outer, index) {
  let dir;
  for (const m of outer.slice(0, index).matchAll(/\bfind\s+(?:-[HLP]\s+)?("[^"\n]*"|'[^'\n]*'|[^\s-][^\s]{0,500})/g)) {
    dir = m[1].replace(/^["']|["']$/g, '');
  }
  return dir;
}

function checkInPlace(outer, masked, cwdAt, repoRoot) {
  for (const [tool, flagRe] of [
    ['sed', SED_INPLACE],
    ['perl', PERL_INPLACE],
  ]) {
    for (const hit of scan(cmdRe(tool, String.raw`(?:\.exe)?(?=\s)([^;&|\n]*)`), outer, masked)) {
      if (!flagRe.test(hit.margs[0])) continue; // the flag must be outside any quoted script
      const cwd = cwdAt(hit.index);
      if (repoSources(hit.args[0], cwd, repoRoot).length > 0) {
        return `\`${tool} -i\` rewrites a repo source file in place.${DENY_SUFFIX}`;
      }
      if (/xargs|-exec/.test(hit.whole)) {
        // find DIR ... -exec: only when DIR is in the repo; xargs (no directory to read): the cwd
        const dir = /-exec/.test(hit.whole) ? findDir(outer, hit.index) : undefined;
        const inRepo = dir === undefined ? cwdInRepo(cwd, repoRoot) : isRepoSource(`${dir}/x.md`, cwd, repoRoot);
        if (inRepo) {
          return `\`${tool} -i\` over a file list (xargs or find -exec) rewrites repo files in place.${DENY_SUFFIX}`;
        }
      }
    }
  }
  return null;
}

// --- scripts (python, node) ------------------------------------------------------------------

/** Arguments of the call whose `(` ends just before `start`, split at depth 0. */
function callArgs(text, start) {
  const args = [];
  let depth = 0;
  let cur = '';
  let q = null;
  for (let i = start; i < text.length && i < start + 600; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += text[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        args.push(cur.trim());
        args.end = i;
        return args;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  args.push(cur.trim());
  return args;
}

const unquote = s => {
  const m = /^(['"`])([^'"`\n]*)\1$/.exec(String(s ?? '').trim());
  return m ? m[2] : null;
};

/** A literal path, a variable assigned a literal, Path(<either>) or a join of those; null when unknown. */
function resolveExpr(expr, vars) {
  const e = String(expr ?? '').trim();
  const lit = unquote(e);
  if (lit !== null) return lit;
  const p = /^Path\((.*)\)$/s.exec(e);
  if (p) return resolveExpr(p[1], vars);
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return vars.get(e) ?? null;
  const j = /^(?:os\.path|path(?:\.posix|\.win32)?)\.(?:join|resolve)\(/.exec(e);
  if (j && e.endsWith(')')) {
    const parts = callArgs(e, j[0].length).map(a => resolveExpr(a, vars));
    return parts.length > 0 && parts.every(s => s !== null) ? parts.join('/') : null;
  }
  return null;
}

/** A write target: its resolved path (null when unknown) and the variable name it came from, if bare. */
const target = (expr, vars) => ({
  path: resolveExpr(expr, vars),
  name: /^[A-Za-z_$][\w$]*$/.test(String(expr ?? '').trim()) ? String(expr).trim() : null,
});

/**
 * Literals a loop variable ranges over: `for X in [...]`, `for X in glob(...)`, `for (const X of [...])`.
 * This is the only fallback for a target that stays unknown; any other unknown target allows.
 */
function loopLiterals(text, name) {
  const lits = [];
  const id = name.replace(/\$/g, '\\$');
  const heads = [
    new RegExp(`\\bfor\\s+${id}\\s+in\\s+([^:]{0,1500}):`, 'g'),
    new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${id}\\s+of\\s+([^{]{0,1500})\\{`, 'g'),
  ];
  for (const re of heads) {
    for (const m of text.matchAll(re)) {
      for (const s of m[1].matchAll(/(['"`])([^'"`\n]+)\1/g)) lits.push(s[2]);
    }
  }
  return lits;
}

const MAX_CHECKED = 200; // write targets / PowerShell writers examined per command

function decideTargets(targets, text, cwd, repoRoot) {
  const loops = new Map(); // variable name -> does its loop range over a repo source
  for (const t of targets.slice(0, MAX_CHECKED)) {
    if (t.path !== null) {
      if (isRepoSource(t.path, cwd, repoRoot)) return true;
    } else if (t.name) {
      if (!loops.has(t.name)) loops.set(t.name, loopLiterals(text, t.name).some(l => isRepoSource(l, cwd, repoRoot)));
      if (loops.get(t.name)) return true;
    }
  }
  return false;
}

export function pythonWritesRepo(rawText, cwd, repoRoot) {
  // Drop string prefixes (r'..', b'..', f'..') so the literals read as plain quoted strings.
  const text = rawText.replace(/\b[rRbBuUfF]{1,2}(?=['"])/g, '');
  const vars = new Map();
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(?:Path\(\s*)?(['"])([^'"\n]+)\2/g)) vars.set(m[1], m[3]);
  const targets = [];
  for (const m of text.matchAll(/(?<![\w.])open\(/g)) {
    const args = callArgs(text, m.index + m[0].length);
    const mode = unquote(args[1]) ?? unquote((args.find(a => /^mode\s*=/.test(a)) ?? '').replace(/^mode\s*=\s*/, ''));
    if (mode !== null && /[wax+]/.test(mode)) targets.push(target(args[0], vars));
  }
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\.open\(/g)) {
    // a file mode, not `webbrowser.open('http://...')` or `Image.open('x.png')`
    const mode = unquote(callArgs(text, m.index + m[0].length)[0]);
    if (mode !== null && /^[rwxabt+U]{1,3}$/.test(mode) && /[wax+]/.test(mode)) targets.push(target(m[1], vars));
  }
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\.write_(?:text|bytes)\(/g)) targets.push(target(m[1], vars));
  for (const m of text.matchAll(/\bPath\(/g)) {
    const args = callArgs(text, m.index + m[0].length);
    const after = text.slice((args.end ?? m.index + m[0].length) + 1);
    if (/^\s*\.write_(?:text|bytes)\(/.test(after) || /^\s*\.open\(\s*['"][wax+]/.test(after)) {
      targets.push(target(args[0], vars));
    }
  }
  for (const m of text.matchAll(/\b(?:os\.(?:replace|rename)|shutil\.(?:copy|copyfile|copy2|move))\(/g)) {
    targets.push(target(callArgs(text, m.index + m[0].length)[1], vars));
  }
  return decideTargets(targets, text, cwd, repoRoot);
}

export function nodeWritesRepo(text, cwd, repoRoot) {
  const vars = new Map();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n$]+)\2/g)) {
    vars.set(m[1], m[3]);
  }
  const targets = [];
  const call = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|copyFileSync|copyFile|cpSync)\s*\(/g;
  for (const m of text.matchAll(call)) {
    const args = callArgs(text, m.index + m[0].length);
    const moves = /^(?:rename|copyFile|cpSync|renameSync|copyFileSync)/.test(m[0]);
    targets.push(target(moves ? args[1] : args[0], vars));
  }
  return decideTargets(targets, text, cwd, repoRoot);
}

const PY_RE = cmdRe('(?:py|python\\d*(?:\\.\\d+)?)', String.raw`(?:\.exe)?(?=\s)([^;&|\n]*)`);
const NODE_RE = cmdRe('node', String.raw`(?:\.exe)?(?=\s)([^;&|\n]*)`);

/** Scripts a python or node command line carries, each with the offset where its command starts. */
function scriptTexts(outer, masked, bodies, re, inlineFlag) {
  const texts = [];
  for (const hit of scan(re, outer, masked)) {
    // inline script: the quoted text is part of the command
    if (inlineFlag.test(hit.margs[0])) texts.push({ text: outer, at: hit.index });
  }
  // script on stdin: the heredoc body that a python or node line introduces
  for (const b of bodies) {
    if (b.kind !== 'heredoc') continue;
    const intro = b.intro;
    if (scan(re, intro, maskQuotes(intro)).some(h => /<</.test(h.margs[0]))) texts.push({ text: b.body, at: b.at });
  }
  return texts;
}

function checkScripts(outer, masked, bodies, cwdAt, repoRoot) {
  for (const s of scriptTexts(outer, masked, bodies, PY_RE, /(?:^|\s)-[A-Za-z]*c(?=\s|$|["'])/)) {
    if (pythonWritesRepo(s.text, cwdAt(s.at), repoRoot)) return `A python script writes a repo source file.${DENY_SUFFIX}`;
  }
  for (const s of scriptTexts(outer, masked, bodies, NODE_RE, /(?:^|\s)(?:-e|--eval|-p|--print)(?=\s|$|["'])/)) {
    if (nodeWritesRepo(s.text, cwdAt(s.at), repoRoot)) return `A node script writes a repo source file.${DENY_SUFFIX}`;
  }
  return null;
}

// --- redirects and PowerShell writes ---------------------------------------------------------

const REDIRECT = /(?:^|[^0-9&>|<=\-])>>?\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s"';&|)<>]+))/gd;
const TEE_RE = cmdRe('tee', String.raw`(?:\.exe)?(?=\s)([^;&|\n]*)`);
const ECHO_RE = cmdRe('(?:echo|printf)', String.raw`(?=\s)([^;&|\n]*)`);
const PS_WRITER = /\b(?:Set-Content|Add-Content|Out-File|WriteAllText|WriteAllLines|WriteAllBytes)\b/i;
const PS_MANGLE = /(?:-replace\b|\.Replace\(|@['"])/i;
const PS_VALUE_PARAMS = /^-(?:Encoding|Value|Width|Stream|Delimiter|InputObject|Filter|Include|Exclude)$/i;

/** Redirect (`> path`) and `tee path` targets on one line; quoted `>` is not a redirect. */
function redirectTargetsIn(line) {
  const masked = maskQuotes(line);
  const targets = [];
  for (const m of scan(REDIRECT, line, masked)) targets.push(m.args[0] ?? m.args[1] ?? m.args[2]);
  for (const m of scan(TEE_RE, line, masked)) targets.push(...pathTokens(m.args[0]));
  return targets;
}

/** The path a PowerShell writer cmdlet or WriteAll* call writes to, from its own segment only. */
function psTarget(segment) {
  if (/^\w*WriteAll/i.test(segment)) {
    const call = /^[^(]*\(\s*("[^"\n]+"|'[^'\n]+'|[^,)\s]+)/.exec(segment); // WriteAllText('path', ...)
    return call ? call[1].replace(/^["']|["']$/g, '') : null;
  }
  const named = /-(?:Literal)?Path\s+("[^"\n]+"|'[^'\n]+'|[^\s;|]+)|-FilePath\s+("[^"\n]+"|'[^'\n]+'|[^\s;|]+)/i.exec(segment);
  if (named) return (named[1] ?? named[2]).replace(/^["']|["']$/g, '');
  const toks = segment.match(/"[^"\n]*"|'[^'\n]*'|\S+/g) ?? [];
  for (let i = 1; i < toks.length; i++) {
    if (PS_VALUE_PARAMS.test(toks[i])) {
      i++;
      continue;
    }
    if (toks[i].startsWith('-')) continue;
    return toks[i].replace(/^["']|["']$/g, '');
  }
  return null;
}

function checkRedirects(text, outer, masked, bodies, cwdAt, repoRoot) {
  const targets = []; // { path, at }: where the write is, so the working directory at that point applies
  // A heredoc or here-string written onto a path: the redirect sits on the line that opens or closes it.
  for (const b of bodies) {
    for (const line of [b.intro, b.closing]) if (line) for (const t of redirectTargetsIn(line)) targets.push({ path: t, at: b.at });
  }
  for (const m of scan(ECHO_RE, outer, masked)) {
    for (const t of redirectTargetsIn(`echo ${m.args[0]}`)) targets.push({ path: t, at: m.index });
  }
  const hit = targets.find(t => isRepoSource(t.path, cwdAt(t.at), repoRoot));
  if (hit) return `A heredoc, echo or printf is written onto the repo source file ${hit.path}.${DENY_SUFFIX}`;
  if (PS_MANGLE.test(text)) {
    let lineAt = 0;
    let writers = 0;
    for (const line of outer.split('\n')) {
      const start = lineAt;
      lineAt += line.length + 1;
      const lm = maskQuotes(line);
      for (const w of lm.matchAll(new RegExp(PS_WRITER.source, 'gi'))) {
        if (++writers > MAX_CHECKED) return null;
        const end = lm.slice(w.index).search(/[;|]/);
        const segment = line.slice(w.index, end < 0 ? line.length : w.index + end);
        const dest = psTarget(segment);
        if (dest && isRepoSource(dest, cwdAt(start + w.index), repoRoot)) {
          return `A PowerShell write (Set-Content, Out-File, WriteAllText) rewrites the repo source file ${dest}.${DENY_SUFFIX}`;
        }
      }
    }
  }
  return null;
}

// --- working directory -----------------------------------------------------------------------

const CD_RE = cmdRe(
  '(?:cd|pushd|Push-Location|Set-Location|sl)',
  String.raw`(?=\s)\s+(?:-\S{1,40}\s+){0,3}(?:"([^"\n]+)"|'([^'\n]+)'|([^\s;&|]+))`
);

const POP_RE = cmdRe('(?:popd|Pop-Location)', String.raw`(?![\w-])`);
const MAX_CDS = 50; // more directory changes than this are not a real command: cwd unknown

/**
 * Returns `cwdAt(offset)`: the working directory where the command text at `offset` runs, after the
 * `cd` segments before it (null when unresolvable, for a `popd` or a `$VAR` directory).
 */
export function cwdResolver(outer, masked, cwd, repoRoot = REPO_ROOT) {
  const moves = [
    ...scan(CD_RE, outer, masked).map(m => ({ index: m.index, dir: m.args[0] ?? m.args[1] ?? m.args[2] })),
    ...scan(POP_RE, outer, masked).map(m => ({ index: m.index, dir: null })),
  ].sort((a, b) => a.index - b.index);
  return offset => {
    let cur = cwd;
    let n = 0;
    for (const mv of moves) {
      if (mv.index >= offset) break;
      const dir = mv.dir;
      if (++n > MAX_CDS || !dir || /^[$~%-]|\$|%[A-Za-z_]+%/.test(dir)) return null;
      const d = normalize(dir.replace(/\\ /g, ' '));
      if (/^([a-zA-Z]:)?\//.test(d)) cur = d;
      else if (cur === null) return null;
      else cur = path.posix.normalize(`${cur ? normalize(cur) : normalize(repoRoot)}/${d}`);
    }
    return cur;
  };
}

// --- decision --------------------------------------------------------------------------------

/** Returns the deny reason, or null to allow. Never throws. */
export function decide(command, startCwd = '', repoRoot = REPO_ROOT) {
  try {
    const text = String(command ?? '');
    if (!text.trim() || text.length > MAX_ANALYZE) return null;
    const { outer, bodies } = splitBodies(text);
    const masked = maskQuotes(outer);
    const cwdAt = cwdResolver(outer, masked, startCwd, repoRoot);
    return (
      checkInPlace(outer, masked, cwdAt, repoRoot) ??
      checkScripts(outer, masked, bodies, cwdAt, repoRoot) ??
      checkRedirects(text, outer, masked, bodies, cwdAt, repoRoot)
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
