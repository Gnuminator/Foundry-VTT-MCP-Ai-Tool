#!/usr/bin/env node
// PostToolUse check for Edit, Write and MultiEdit (Claude Code hook): when a file under
// packages/mcp-server/src/tools/modules/ gains a tool in its `tools` map (compared with HEAD), it
// lists the steps a new tool still needs, from the files as they are now:
//   - exactly one `set` in the tool's entry
//   - a live sweep step (write tools): the name in scripts/live-write-sweep.mjs, or a recorded skip
//     in live-sweep-coverage.test.ts
//   - the tool reference pages: the name in docs/reference/TOOL-SETS.md (else run `npm run docs:tools`)
//   - the count tests: tool-catalog.test.ts compares the pages with the sets (run it after docs:tools)
//   - a write tool that needs a new bridge handler: its entry in write-gate.ts and write-gate.test.ts
// It prints only the steps still open and nothing when all are done or the tools map did not gain
// a name, so it costs no tokens on ordinary edits. It never blocks; any failure prints nothing.
//
// Limit: the write-gate line is a reminder, because a tool name is not its bridge handler name.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES_DIR = 'packages/mcp-server/src/tools/modules/';
const SWEEP = 'scripts/live-write-sweep.mjs';
const SWEEP_TEST = 'packages/cogm-dashboard/src/live-sweep-coverage.test.ts';
const TOOL_SETS_DOC = 'docs/reference/TOOL-SETS.md';

/** Entries of the `tools: {` map: name -> its source block. */
export function toolEntries(src) {
  const text = src.replace(/\r\n/g, '\n');
  const start = text.search(/^\s*tools:\s*\{/m);
  if (start < 0) return new Map();
  const lines = text.slice(start).split('\n').slice(1);
  const entries = new Map();
  let name = null;
  let block = [];
  const flush = () => {
    if (name) entries.set(name, block.join('\n'));
  };
  for (const line of lines) {
    const key = /^ {4}(?:'([a-z][a-z0-9-]*)'|([A-Za-z][\w]*))\s*:\s*[{(]/.exec(line);
    if (key) {
      flush();
      name = key[1] ?? key[2];
      block = [line];
    } else if (/^ {2}\}/.test(line)) {
      break; // end of the tools map
    } else if (name) {
      block.push(line);
    }
  }
  flush();
  return entries;
}

/** Tool names in `now` that `before` (the committed file, or '') did not have. */
export function addedTools(before, now) {
  const old = toolEntries(before);
  return [...toolEntries(now)].filter(([name]) => !old.has(name));
}

/** The open steps for one added tool; `read` returns a repo file's text or ''. */
export function openSteps(name, block, read) {
  const steps = [];
  const sets = (block.match(/\bset\s*:/g) ?? []).length;
  if (sets !== 1)
    steps.push(`${name}: needs exactly one \`set\` in its tools entry (found ${sets})`);
  const isWrite = /kind\s*:\s*'(?:write|recordless-write)'/.test(block);
  if (isWrite) {
    const swept = read(SWEEP).includes(name) || read(SWEEP_TEST).includes(`'${name}'`);
    if (!swept)
      steps.push(
        `${name}: no live sweep step in ${SWEEP} and no recorded skip in ${SWEEP_TEST} (live-sweep-coverage fails)`
      );
  }
  if (!read(TOOL_SETS_DOC).includes(`\`${name}\``))
    steps.push(
      `${name}: not on ${TOOL_SETS_DOC}; run \`npm run docs:tools\`, then the tool-catalog count test`
    );
  if (isWrite)
    steps.push(
      `${name}: if it calls a new bridge handler, register it with its kind in packages/foundry-module/src/write-gate.ts and pin it in write-gate.test.ts`
    );
  return steps;
}

function committed(root, rel) {
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString('utf8');
  } catch {
    return ''; // a new file
  }
}

export function run(input) {
  try {
    if (!input || typeof input !== 'object') return '';
    const tool = input.tool_name;
    if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') return '';
    const file = input.tool_input?.file_path;
    if (!file) return '';
    const cwd = input.cwd || REPO_ROOT;
    const abs = path.resolve(cwd, String(file));
    let top;
    try {
      top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: path.dirname(abs),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
        .toString('utf8')
        .trim();
    } catch {
      return '';
    }
    const rel = path.relative(top, abs).replace(/\\/g, '/');
    if (!rel.startsWith(MODULES_DIR) || !rel.endsWith('.ts') || rel.endsWith('.test.ts')) return '';
    if (!existsSync(abs)) return '';
    const added = addedTools(committed(top, rel), readFileSync(abs, 'utf8'));
    if (added.length === 0) return '';
    const read = r => {
      try {
        return readFileSync(path.join(top, r), 'utf8');
      } catch {
        return '';
      }
    };
    const open = added.flatMap(([name, block]) => openSteps(name, block, read));
    if (open.length === 0) return '';
    const list = open.map(s => `- ${s}`).join('\n');
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `New tool in ${rel}: steps still open (.claude/hooks/tool-added.mjs):\n${list}`,
      },
    });
  } catch {
    return '';
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const out = run(input);
  if (out) process.stdout.write(`${out}\n`);
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
