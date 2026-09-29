/**
 * Escaping for Foundry text written into Obsidian notes (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 5, "Text nodes are escaped"). Data from Foundry must stay inert text:
 * it may never open raw HTML, a wikilink, an embed, a Markdown link, a footnote,
 * a code span or fence, a comment, a tag, a block id, math, or a Templater
 * command. Formatting characters are escaped too, so the text reads the same.
 */
import { neutralizeTemplater } from './ownership.js';

/** Characters escaped with a backslash wherever they appear. */
const INLINE = /[\\`*_[\]$~|]/g;
/** Block markers that change structure when they start a line (after escaping). */
const LINE_START = /^(>|[-+]|=|#)/;
const ORDERED_START = /^(\d+)([.)])/;

function escapeInline(text: string): string {
  return (
    text
      .replace(INLINE, ch => `\\${ch}`)
      // Entities first: data cannot write `&lt;` that would decode into markup.
      .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;')
      // Raw HTML and `<url>` autolinks: never from data.
      .replace(/</g, '&lt;')
      // Obsidian comments `%%...%%`.
      .replace(/%%/g, '%\\%')
      // Highlights `==text==`: harmless, but keep the text literal.
      .replace(/==/g, '=\\=')
      // Tags: `#word` at a word start.
      .replace(/(^|[\s(])#(?=[^\s#])/g, '$1\\#')
      // Block ids `^id` (only meaningful at a line end; escaped everywhere).
      .replace(/\^/g, '\\^')
  );
}

/**
 * Inline text from Foundry as inert Markdown, whitespace kept. Use it for text
 * inside a line; a line built from it still needs `escapeLineStart`.
 */
export function escapeInlineText(text: string): string {
  return neutralizeTemplater(escapeInline(text));
}

/**
 * The start of one output line: leading whitespace dropped (no indented code
 * blocks) and a marker that would start a block (quote, list, setext
 * underline, ordered list) escaped. Input is already inline-escaped.
 */
export function escapeLineStart(line: string): string {
  return line.replace(/^\s+/, '').replace(LINE_START, '\\$1').replace(ORDERED_START, '$1\\$2');
}

/** Plain text from Foundry as inert Markdown: inline-escaped, each line's start escaped. */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => escapeLineStart(escapeInlineText(line)))
    .join('\n');
}

/** Whitespace collapsed to single spaces, trimmed, cut to `max` characters (never inside a surrogate pair). */
export function collapseWhitespace(text: string, max = Infinity): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return Array.from(one).slice(0, max).join('').trimEnd();
}

/** A link label: one line, at most 200 characters, escaped like text (`\ [ ]` included). */
export function escapeLinkLabel(label: string): string {
  return escapeMarkdownText(collapseWhitespace(label, 200));
}

/**
 * Inline code for text we show verbatim (inline rolls, uuids). The fence is one
 * backtick longer than the longest run inside; the content is one line.
 */
export function codeSpan(text: string): string {
  const content = collapseWhitespace(text);
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return neutralizeTemplater(`${fence}${pad}${content}${pad}${fence}`);
}

/** Percent-encode what could end or break a Markdown link destination. */
function encodeUnsafe(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`;
}

/** A link destination that cannot break out of `(...)`: http(s) only, else null. */
export function safeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed.href.replace(/[()<>"'`\\\s]/g, encodeUnsafe);
}
