/**
 * HTML to Markdown for the player vault (O7).
 *
 * Handout HTML has already been through `sanitizeHandoutHtml`: only a small tag allowlist, no
 * attributes, entity-escaped text. This converter handles exactly that allowlist, ignores every
 * attribute anyway (links become their text, images vanish) and is tolerant of anything else
 * (unknown tags keep their text, scripts and other active tags are dropped with their content).
 *
 * The output is also neutralized: Obsidian must not be able to execute or follow anything that came
 * from a handout or a name. No raw HTML, no wikilinks (`[[`), no Templater tags (`<%`), no
 * `obsidian:` links, no Dataview inline queries, and no fenced block ever carries a language
 * (so no ```dataview or ```dataviewjs blocks).
 */
import { parseDOM } from 'htmlparser2';

type DomNode = ReturnType<typeof parseDOM>[number];

interface ElementNode {
  name: string;
  children: DomNode[];
}

/** Marks a line break while a paragraph is assembled (private-use character, never in text). */
const BR = '';

const MAX_DEPTH = 64;

/** Tags dropped together with everything inside them. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'title',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'textarea',
  'select',
  'option',
  'button',
  'input',
  'img',
  'audio',
  'video',
  'canvas',
]);

/** Tags that start a block of their own. */
const BLOCK_TAGS = new Set([
  'p',
  'hr',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'pre',
  // Unknown containers that are treated as transparent blocks.
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'center',
  'address',
  'fieldset',
]);

/** Tags that are only a transparent wrapper around more blocks. */
const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'nav',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'center',
  'address',
  'fieldset',
  'thead',
  'tbody',
  'tfoot',
  'tr',
]);

function elementOf(node: DomNode): (DomNode & ElementNode) | null {
  const n = node as Partial<ElementNode> & { type?: unknown };
  if (typeof n.name === 'string' && Array.isArray(n.children)) {
    return node as DomNode & ElementNode;
  }
  return null;
}

function textOf(node: DomNode): string | null {
  const n = node as { type?: unknown; data?: unknown };
  return n.type === 'text' && typeof n.data === 'string' ? n.data : null;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Escape one run of plain text so Markdown and Obsidian read it as text only. */
function escapeInline(text: string): string {
  return text
    .split(BR)
    .join('')
    .replace(/[\\`*_[\]>~|#$^]/g, '\\$&')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/obsidian:/gi, m => `${m.slice(0, -1)}&#58;`)
    .replace(/%(?=%)/g, '%\\');
}

/** A list or number marker at the start of a line would turn text into a list: escape it. */
function escapeLineStart(text: string): string {
  return text
    .replace(/^( {0,3})(\d{1,9})([.)])(?=\s|$)/gm, '$1$2\\$3')
    .replace(/^( {0,3})([-+])(?=\s|$|-)/gm, '$1\\$2')
    .replace(/^( {0,3})=(?==*\s*$)/gm, '$1\\=');
}

/** Last pass over a whole document: nothing Obsidian could follow or run survives it. */
function finalize(md: string): string {
  return md
    .replace(/<%/g, '&lt;%')
    .replace(/\[{2,}/g, m => '\\['.repeat(m.length))
    .replace(/\]{2,}/g, m => '\\]'.repeat(m.length))
    .replace(/obsidian:/gi, m => `${m.slice(0, -1)}&#58;`)
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Neutralize plain text (a title, a name, a sheet string, an event line) for a Markdown note: the
 * same escaping the converter applies to handout text, on one line. Line breaks become spaces.
 */
export function neutralizeMarkdownText(text: string): string {
  const flat = String(text ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
  return finalize(escapeLineStart(escapeInline(flat)));
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/** All text under the nodes (line breaks as newlines), dropped tags skipped. Not recursive. */
function textContent(nodes: DomNode[]): string {
  let out = '';
  const stack: DomNode[] = [...nodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const text = textOf(node);
    if (text !== null) {
      out += text;
      continue;
    }
    const el = elementOf(node);
    if (!el) continue;
    const name = el.name.toLowerCase();
    if (DROPPED_TAGS.has(name)) continue;
    if (name === 'br') out += '\n';
    else for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
  }
  return out;
}

/** Inline code. A Dataview inline query (starts with `=` or `$=`) is written as plain text. */
function codeSpan(content: string): string {
  const flat = content.replace(/\s*[\r\n]+\s*/g, ' ');
  const probe = flat.trimStart();
  if (probe === '') return '';
  if (probe.startsWith('=') || probe.startsWith('$=')) return escapeInline(flat.trim());
  let longest = 0;
  for (const run of flat.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const mark = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${mark}${pad}${flat}${pad}${mark}`;
}

/** Wrap content in an emphasis mark, keeping the edge whitespace outside the marks. */
function wrapMark(content: string, mark: string): string {
  const core = content.trim();
  if (core === '') return content;
  const lead = content.slice(0, content.length - content.trimStart().length);
  const trail = content.slice(content.trimEnd().length);
  return `${lead}${mark}${core}${mark}${trail}`;
}

function inline(nodes: DomNode[], depth = 0): string {
  let out = '';
  for (const node of nodes) {
    const text = textOf(node);
    if (text !== null) {
      out += escapeInline(text.replace(/\s+/g, ' '));
      continue;
    }
    const el = elementOf(node);
    if (!el) continue;
    const name = el.name.toLowerCase();
    if (DROPPED_TAGS.has(name)) continue;
    if (depth >= MAX_DEPTH) {
      out += escapeInline(textContent(el.children).replace(/\s+/g, ' '));
      continue;
    }
    switch (name) {
      case 'br':
        out += BR;
        break;
      case 'hr':
        out += ' ';
        break;
      case 'strong':
      case 'b':
        out += wrapMark(inline(el.children, depth + 1), '**');
        break;
      case 'em':
      case 'i':
        out += wrapMark(inline(el.children, depth + 1), '*');
        break;
      case 's':
      case 'del':
        out += wrapMark(inline(el.children, depth + 1), '~~');
        break;
      case 'code':
        out += codeSpan(textContent(el.children));
        break;
      case 'pre':
        out += codeSpan(textContent(el.children));
        break;
      default:
        if (BLOCK_TAGS.has(name)) {
          out += ` ${inline(el.children, depth + 1)} `;
        } else {
          out += inline(el.children, depth + 1); // a, span, u, sup, sub and unknown tags: text only
        }
    }
  }
  return out;
}

/** Tidy an assembled inline run: no spaces around breaks, no breaks at the edges. */
function tidy(run: string): string {
  return run
    .replace(/ {2,}/g, ' ')
    .replace(/ ? ?/g, BR)
    .replace(new RegExp(`^[ ${BR}]+|[ ${BR}]+$`, 'g'), '');
}

function flatInline(nodes: DomNode[], depth: number): string {
  return tidy(inline(nodes, depth)).split(BR).join(' ').replace(/ {2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function paragraph(run: DomNode[], depth: number): string {
  const text = tidy(inline(run, depth));
  if (text === '') return '';
  return escapeLineStart(text.split(BR).join('  \n'));
}

function indentLines(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? first + line : line === '' ? '' : rest + line))
    .join('\n');
}

function joinBlocks(blocks: string[]): string {
  let out = '';
  blocks.forEach((block, i) => {
    if (i === 0) out = block;
    else out += (/^(\s*)([-+]|\d+[.)])\s/.test(block) ? '\n' : '\n\n') + block;
  });
  return out;
}

function renderList(el: DomNode & ElementNode, ordered: boolean, depth: number): string {
  const items: string[][] = [];
  let loose: DomNode[] = [];
  const flushLoose = (): void => {
    if (loose.length === 0) return;
    const p = paragraph(loose, depth + 1);
    if (p !== '') items.push([p]);
    loose = [];
  };
  for (const child of el.children) {
    const childEl = elementOf(child);
    const name = childEl?.name.toLowerCase();
    if (childEl && name === 'li') {
      flushLoose();
      const body = joinBlocks(renderBlocks(childEl.children, depth + 1));
      items.push([body]);
    } else if (childEl && !DROPPED_TAGS.has(name ?? '') && BLOCK_TAGS.has(name ?? '')) {
      flushLoose();
      const blocks = renderBlocks([child], depth + 1);
      const last = items[items.length - 1];
      if (last) last.push(...blocks);
      else if (blocks.length > 0) items.push(blocks);
    } else if (childEl && DROPPED_TAGS.has(name ?? '')) {
      continue;
    } else {
      loose.push(child);
    }
  }
  flushLoose();
  const lines: string[] = [];
  items.forEach((parts, index) => {
    const marker = ordered ? `${index + 1}. ` : '- ';
    const body = joinBlocks(parts);
    lines.push(indentLines(body === '' ? '' : body, marker, ' '.repeat(marker.length)).trimEnd());
  });
  return lines.join('\n');
}

function cellText(cell: DomNode & ElementNode, depth: number): string {
  return flatInline(cell.children, depth + 1).replace(/(?<!\\)\|/g, '\\|');
}

function renderTable(el: DomNode & ElementNode, depth: number): string {
  const rows: Array<DomNode & ElementNode> = [];
  for (const child of el.children) {
    const c = elementOf(child);
    if (!c) continue;
    const name = c.name.toLowerCase();
    if (name === 'tr') rows.push(c);
    else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      for (const inner of c.children) {
        const r = elementOf(inner);
        if (r?.name.toLowerCase() === 'tr') rows.push(r);
      }
    }
  }
  const grid = rows
    .map(row =>
      row.children
        .map(elementOf)
        .filter((c): c is DomNode & ElementNode => {
          const n = c?.name.toLowerCase();
          return n === 'td' || n === 'th';
        })
        .map(c => cellText(c, depth))
    )
    .filter(cells => cells.length > 0);
  if (grid.length === 0) return '';
  const width = grid[0]?.length ?? 0;
  const regular = grid.every(cells => cells.length === width);
  if (regular) {
    const line = (cells: string[]): string =>
      `| ${cells.map(c => (c === '' ? ' ' : c)).join(' | ')} |`;
    const [head, ...body] = grid;
    return [
      line(head ?? []),
      `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
      ...body.map(line),
    ].join('\n');
  }
  // Irregular table (spans, ragged rows): one bullet per row, cells separated by a bar.
  return grid.map(cells => `- ${cells.filter(c => c !== '').join(' \\| ')}`).join('\n');
}

function fence(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
  if (body === '') return '';
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const mark = '`'.repeat(Math.max(3, longest + 1));
  return `${mark}\n${body}\n${mark}`;
}

function renderBlocks(nodes: DomNode[], depth: number): string[] {
  const out: string[] = [];
  if (depth >= MAX_DEPTH) {
    const flat = escapeInline(textContent(nodes).replace(/\s+/g, ' ')).trim();
    return flat === '' ? [] : [flat];
  }
  let run: DomNode[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const p = paragraph(run, depth);
    if (p !== '') out.push(p);
    run = [];
  };
  for (const node of nodes) {
    const el = elementOf(node);
    if (!el) {
      if (textOf(node) !== null) run.push(node);
      continue;
    }
    const name = el.name.toLowerCase();
    if (DROPPED_TAGS.has(name)) continue;
    if (!BLOCK_TAGS.has(name)) {
      run.push(node);
      continue;
    }
    flush();
    if (CONTAINER_TAGS.has(name)) {
      out.push(...renderBlocks(el.children, depth + 1));
    } else if (name === 'p') {
      const p = paragraph(el.children, depth + 1);
      if (p !== '') out.push(p);
    } else if (/^h[1-6]$/.test(name)) {
      const text = flatInline(el.children, depth + 1);
      if (text !== '') out.push(`${'#'.repeat(Number(name.slice(1)))} ${text}`);
    } else if (name === 'hr') {
      out.push('---');
    } else if (name === 'ul' || name === 'ol') {
      const list = renderList(el, name === 'ol', depth + 1);
      if (list !== '') out.push(list);
    } else if (name === 'li') {
      const body = joinBlocks(renderBlocks(el.children, depth + 1));
      if (body !== '') out.push(indentLines(body, '- ', '  '));
    } else if (name === 'blockquote') {
      const inner = renderBlocks(el.children, depth + 1).join('\n\n');
      if (inner !== '') {
        out.push(
          inner
            .split('\n')
            .map(line => (line === '' ? '>' : `> ${line}`))
            .join('\n')
        );
      }
    } else if (name === 'table') {
      const table = renderTable(el, depth + 1);
      if (table !== '') out.push(table);
    } else if (name === 'pre') {
      const block = fence(textContent(el.children));
      if (block !== '') out.push(block);
    }
  }
  flush();
  return out;
}

/**
 * Convert sanitized handout HTML (or any simple HTML) to neutralized Markdown. Never throws on
 * malformed input; an empty or tag-only input gives an empty string.
 */
export function htmlToMarkdown(html: string): string {
  const nodes = parseDOM(String(html ?? ''), { decodeEntities: true, lowerCaseTags: true });
  return finalize(renderBlocks(nodes, 0).join('\n\n'));
}
