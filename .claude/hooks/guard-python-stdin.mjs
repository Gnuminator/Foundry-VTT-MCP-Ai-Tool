#!/usr/bin/env node
// PreToolUse guard for Bash and PowerShell (Claude Code hook).
//
// On Windows, `python3` resolves to the Microsoft Store stub, which waits forever
// instead of running, and `python -` without piped input waits for stdin. Both
// left background tasks hanging for hours (2026-09-30). This hook refuses such
// commands before they run and says what to use instead.
//
// Reads the hook payload (JSON) on stdin; prints a deny decision or nothing.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    const payload = JSON.parse(raw);
    command = String(payload?.tool_input?.command ?? '');
  } catch {
    return; // not a payload we understand: allow
  }

  const reasons = [];
  // `python3` in command position (start of a line, or after ; & | or an opening
  // parenthesis), not as an argument or inside quoted text such as a commit message.
  if (/(^|[;&|(\n])\s*(\S*[\\/])?python3(\.exe)?(?=\s|$|[;&|)])/.test(command)) {
    reasons.push(
      '`python3` is the Microsoft Store stub on this PC and hangs forever. Use `python` (C:\\Python314), the 3.12 path C:\\Users\\chris\\AppData\\Local\\Programs\\Python\\Python312\\python.exe, or a project venv.'
    );
  }
  // `python -` / `python.exe -` reading a script from stdin without a heredoc or pipe.
  const stdinScript = /(^|[\s;&|(])(\S*python(\.exe)?)\s+-(?=\s|$)(?![^\n]*<<)/m;
  const piped = /\|\s*\S*python(\.exe)?\s+-(\s|$)/;
  if (stdinScript.test(command) && !piped.test(command)) {
    reasons.push(
      '`python -` without a heredoc or pipe waits for stdin forever. Write the script to a file (scratchpad) and run `python file.py`, or use `python - <<\'EOF\' ... EOF`.'
    );
  }

  if (reasons.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Blocked by .claude/hooks/guard-python-stdin.mjs: ${reasons.join(' ')}`,
      },
    })
  );
});
