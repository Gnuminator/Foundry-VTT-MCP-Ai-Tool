// @ts-check

/** Paths whose PRs fail only against the real host, so the description must state a live check. */
const AREAS = [
  {
    name: 'Module',
    prefix: 'packages/foundry-module/src/',
    hint: 'name the run on test server A with real dnd5e data, or say why there was none',
  },
  {
    name: 'Pi',
    prefix: 'scripts/pi/remote/',
    hint: 'name the ARM64 container run and the read-only deploy/pi/deployed-state.ps1 check, or say why there was none',
  },
];

/**
 * The text of a `Live check:` line with real content (not empty, not a template placeholder), or
 * null. @param {string} body
 */
export function liveCheckLine(body) {
  for (const raw of withoutComments(String(body ?? '')).split(/\r?\n/)) {
    const m =
      /^\s*(?:[-*]\s+)?(?:live check:|\*\*live check:\*\*|\*\*live check\*\*:)\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const text = m[1].trim();
    if (/[a-z0-9]{3}/i.test(text) && !/^<[^>]*>$/.test(text)) return text;
  }
  return null;
}

/** The text with every HTML comment cut out (an unclosed one runs to the end). @param {string} text */
function withoutComments(text) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf('-->', open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/**
 * The refusal for a PR that touches Module source or Pi stage scripts without a `Live check:` line
 * in its description, or null. Any touched file counts, tests too (a test-only PR says so).
 * @param {{ path: string }[]} files @param {string} body
 * @returns {string | null}
 */
export function liveCheckProblem(files, body) {
  const paths = files.map(f => f.path.replace(/\\/g, '/'));
  const hit = AREAS.filter(a => paths.some(p => p.startsWith(a.prefix)));
  if (hit.length === 0 || liveCheckLine(body) !== null) return null;
  const where = hit.map(a => `${a.name} code (${a.prefix})`).join(' and ');
  const how = hit.map(a => `${a.name}: ${a.hint}`).join('; ');
  return `live check: the PR touches ${where} but its description has no "Live check:" line; add one (${how})`;
}
