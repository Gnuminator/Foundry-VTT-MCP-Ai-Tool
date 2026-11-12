/**
 * The vault Backlog.md item parser and the pure one-item edits that `scripts/backlog.mjs` makes.
 * `scripts/planner-wake.mjs` re-exports `parseProgress` from here.
 *
 * An item is a `## <S|M|L> <title>` line at the start of a line, then every line up to the next
 * line that starts with `#` or `##` and a space. Only whole lines count: a heading written inside a
 * sentence is text (a fold script once doubled Backlog.md by matching one). A chapter is any other
 * `## ` heading. Field lines are `- <name>: <value>`; `claimed:` is also read without the leading
 * `- ` (the board and older hands wrote it both ways).
 *
 * Every edit takes the whole file text and returns the new text in the file's own line endings,
 * then `checkEdit` compares the two: only the target item may change, the item count and the line
 * count must move by exactly what the command meant, the preamble must stay intact and no item may
 * sit under an old Done chapter (the Done list lives in `Backlog done.md` now).
 */

export const ITEM_HEADING = /^##\s+([SML])\s+(.*\S)\s*$/;
const ANY_HEADING = /^#{1,2}\s/;
const FIELD = /^-?\s*([A-Za-z][A-Za-z ]*?)\s*:\s?(.*)$/;

/** @param {string} text */
export const newlineOf = text => (text.includes('\r\n') ? '\r\n' : '\n');

/**
 * @typedef {{ id: string, size: string, title: string, start: number, end: number,
 *   lines: string[], fields: Map<string, string[]> }} Item
 * @typedef {{ start: number, end: number, title: string }} Chapter
 * @typedef {{ nl: string, lines: string[], items: Item[], chapters: Chapter[], preambleEnd: number }} Parsed
 */

/**
 * Field name -> values, for `- name: value` lines (lowercased names, `claimed` also without `- `).
 * @param {string[]} lines
 */
export function fieldsOf(lines) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const l of lines.slice(1)) {
    const m = l.startsWith('- ') || /^claimed\s*:/i.test(l) ? FIELD.exec(l) : null;
    if (!m) continue;
    const name = m[1].toLowerCase();
    map.set(name, [...(map.get(name) ?? []), m[2].trim()]);
  }
  return map;
}

/**
 * Split Backlog.md into items and chapters. `end` is exclusive and includes trailing blank lines.
 * @param {string} text
 * @returns {Parsed}
 */
export function parseBacklog(text) {
  const nl = newlineOf(text);
  const lines = text.split(/\r?\n/);
  /** @type {Item[]} */
  const items = [];
  /** @type {Chapter[]} */
  const chapters = [];
  let preambleEnd = lines.length;
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && !ANY_HEADING.test(lines[end])) end++;
    const head = ITEM_HEADING.exec(lines[start]);
    if (head) {
      const block = lines.slice(start, end);
      const fields = fieldsOf(block);
      items.push({
        id: fields.get('id')?.[0] ?? '',
        size: head[1],
        title: head[2],
        start,
        end,
        lines: block,
        fields,
      });
    } else if (/^##\s/.test(lines[start])) {
      chapters.push({ start, end, title: lines[start].replace(/^##\s+/, '').trim() });
    }
    if (preambleEnd === lines.length && /^##\s/.test(lines[start])) preambleEnd = start;
    start = end;
  }
  return { nl, lines, items, chapters, preambleEnd };
}

/**
 * The "ready to merge" progress text: `backlog.mjs progress <id> --ready` writes it and
 * `scripts/merge-runner.mjs` reads it, so both go through these two. Older hand-written lines of
 * the same form (`PR #<n> ready, head <40-hex sha>`) read the same way.
 * @param {number | string} pr @param {string} head @param {string} [review]
 */
export function readyText(pr, head, review) {
  if (!/^\d+$/.test(String(pr))) throw new Error(`--ready needs a PR number, not "${pr}"`);
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('--head needs the full 40-character sha');
  return `PR #${pr} ready, head ${head}${review ? `, review ${review}` : ''}`;
}

/**
 * The PR and head of a ready progress text (its last line, an optional date in front), or null.
 * @param {string} progress
 * @returns {{ pr: number, head: string } | null}
 */
export function parseReady(progress) {
  const last = progress.split('\n').at(-1) ?? '';
  const m = /^(?:\d{4}-\d{2}-\d{2} )?PR #(\d+) ready, head ([0-9a-f]{40})\b/.exec(last.trim());
  return m ? { pr: Number(m[1]), head: m[2] } : null;
}

/**
 * Item id -> its `- progress:` text, for every `## S|M|L` item that has both lines.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseProgress(text) {
  const map = new Map();
  for (const item of parseBacklog(text).items) {
    const progress = (item.fields.get('progress') ?? []).filter(Boolean).join('\n');
    if (item.id && progress) map.set(item.id, progress);
  }
  return map;
}

/** @param {Parsed} p @param {string} id */
export function findItem(p, id) {
  const found = p.items.filter(i => i.id === id);
  if (found.length > 1)
    throw new Error(`item id ${id} appears ${found.length} times in Backlog.md`);
  if (!found.length) throw new Error(`no item with id ${id} in Backlog.md`);
  return found[0];
}

/** `item:<id>` references in a field value. @param {string} value */
export const itemRefs = value => [...value.matchAll(/item:([a-z0-9][a-z0-9-]*)/gi)].map(m => m[1]);

/**
 * The preamble must open with front matter and hold the `# Backlog` title.
 * @param {string[]} lines @param {number} preambleEnd
 */
export function preambleProblem(lines, preambleEnd) {
  const pre = lines.slice(0, preambleEnd);
  if (pre[0] !== '---') return 'the file no longer starts with front matter (---)';
  const close = pre.indexOf('---', 1);
  if (close < 0) return 'the front matter is not closed';
  if (!pre.slice(close + 1).some(l => /^# Backlog\s*$/.test(l)))
    return 'the `# Backlog` title is missing before the first chapter';
  return null;
}

/**
 * Refuse an edit whose result is not exactly the intended one-item change.
 * @param {string} before @param {string} after
 * @param {{ id: string, items: number, lines?: number }} expect id of the changed item, item count
 *   delta (0, -1 for done, +1 for add) and, when known, the line count delta
 */
export function checkEdit(before, after, expect) {
  const a = parseBacklog(before);
  const b = parseBacklog(after);
  const problems = [];
  const pre = preambleProblem(b.lines, b.preambleEnd);
  if (pre) problems.push(pre);
  if (a.lines.slice(0, a.preambleEnd).join('\n') !== b.lines.slice(0, b.preambleEnd).join('\n'))
    problems.push('the preamble changed');
  const done = b.chapters.find(c => /^Done\b/i.test(c.title));
  if (done && b.items.some(i => i.start > done.start))
    problems.push('an item sits under a Done chapter (the Done list is Backlog done.md)');
  if (b.items.length - a.items.length !== expect.items)
    problems.push(
      `item count went from ${a.items.length} to ${b.items.length}, expected a change of ${expect.items}`
    );
  if (expect.lines !== undefined && b.lines.length - a.lines.length !== expect.lines)
    problems.push(
      `line count went from ${a.lines.length} to ${b.lines.length}, expected a change of ${expect.lines}`
    );
  // Trailing blank lines are left out: an item added after another takes over its blank line.
  const key = (/** @type {Item} */ i) => `${i.id}\u0000${trimBlock(i).body.join('\n')}`;
  const others = (/** @type {Parsed} */ p) => p.items.filter(i => i.id !== expect.id).map(key);
  if (others(a).join('\u0001') !== others(b).join('\u0001'))
    problems.push('an item other than the target changed, moved or was removed');
  const chap = (/** @type {Parsed} */ p) => p.chapters.map(c => c.title).join('\u0001');
  if (chap(a) !== chap(b)) problems.push('the chapter headings changed');
  if (problems.length) throw new Error(`refused, the edit looks wrong: ${problems.join('; ')}`);
}

/**
 * Replace lines [start, end) of the parsed file and return the text in its own line endings.
 * @param {Parsed} p @param {number} start @param {number} end @param {string[]} replacement
 */
export function splice(p, start, end, replacement) {
  const lines = [...p.lines.slice(0, start), ...replacement, ...p.lines.slice(end)];
  return lines.join(p.nl);
}

/** The item's lines without its trailing blank lines, and those blank lines. @param {Item} item */
export function trimBlock(item) {
  let n = item.lines.length;
  while (n > 1 && item.lines[n - 1].trim() === '') n--;
  return { body: item.lines.slice(0, n), tail: item.lines.slice(n) };
}

/** A matcher for `- <name>:` lines (and a bare `claimed:` line). @param {string} name */
const isField = name => (/** @type {string} */ l) =>
  (l.startsWith('- ') || (name === 'claimed' && /^claimed\s*:/i.test(l))) &&
  FIELD.exec(l)?.[1].toLowerCase() === name;

/**
 * The item with every `name` line removed and `newLines` inserted where the first one was, or
 * after the last line of the first field in `after` that exists, or after the `- id:` line.
 * @param {string[]} body @param {string} name @param {string[]} newLines @param {string[]} after
 */
export function setField(body, name, newLines, after = []) {
  const first = body.findIndex(isField(name));
  const kept = body.filter(l => !isField(name)(l));
  let at = first;
  if (at < 0) {
    at = -1;
    for (const f of [...after, 'id']) {
      const idx = kept.map(isField(f)).lastIndexOf(true);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    if (at < 0) at = 1;
  } else {
    at = body.slice(0, first).filter(l => !isField(name)(l)).length;
  }
  return [...kept.slice(0, at), ...newLines, ...kept.slice(at)];
}
