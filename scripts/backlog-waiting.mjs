// @ts-check
/**
 * The Waiting.md edit behind `backlog.mjs waiting`, kept apart so backlog.mjs stays under the
 * line limit.
 */
import { newlineOf } from './backlog-items.mjs';

/** @param {string} s */
const oneLine = s => {
  if (/[\r\n]/.test(s)) throw new Error('the text must be one line');
  return s.trim();
};

/**
 * A new "## W<n> <title>" item in Waiting.md, above `## Someday` (or at the end). Idempotent on
 * `key`: an item that already carries a `- key: <key>` line is not added a second time.
 * @param {string} text @param {{ key: string, title: string, due: string, text: string, date: string }} o
 * @returns {{ text: string, added: boolean, n: number }}
 */
export function waitingEdit(text, o) {
  const nl = newlineOf(text);
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.trim() === `- key: ${o.key}`)) return { text, added: false, n: 0 };
  const nums = lines.map(l => /^#{2,3}\s+W(\d+)/i.exec(l)?.[1]).filter(Boolean);
  const n = Math.max(0, ...nums.map(Number)) + 1;
  const block = [
    `## W${n} ${oneLine(o.title)}`,
    `- key: ${o.key}`,
    `- due: ${o.due}`,
    `- ${o.date} (merge runner): ${oneLine(o.text)}`,
    '',
  ];
  let at = lines.findIndex(l => /^##\s+Someday\b/i.test(l));
  if (at < 0) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push('');
    at = lines.length;
  }
  lines.splice(at, 0, ...block);
  return { text: lines.join(nl), added: true, n };
}
