/**
 * Journal page text to Markdown for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 5). The HTML is parsed with htmlparser2 and Markdown is REBUILT from an
 * allowlist (headings, paragraphs, line breaks, bold, italic, strikethrough,
 * lists, blockquotes, simple tables, `pre`, rules); no raw HTML is ever written.
 * `section.secret` becomes a collapsed `[!secret]-` callout (the GM vault may hold
 * secrets, OBSIDIAN-PLAN decision 3). Images become `[image: alt]`. Every text
 * run goes through `links.ts` (Foundry links rewritten, the rest escaped), and
 * every output line's start is escaped before we add our own block markers.
 */
import { parseDOM } from 'htmlparser2';

import { rewriteText } from './links.js';
import { escapeInlineText, escapeLineStart, safeUrl } from './md-escape.js';
import type { LinkContext } from './mirror-common.js';

type DomNode = ReturnType<typeof parseDOM>[number];

interface ElementNode {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

/** Dropped with everything inside them. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'template',
  'svg',
  'math',
  'noscript',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'audio',
  'video',
  'canvas',
  'head',
  'title',
  'meta',
  'link',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'hr',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  ...HEADINGS,
]);
/** Nesting beyond this renders as plain text (pathological input). */
const MAX_DEPTH = 64;

function isElement(node: DomNode): node is DomNode & ElementNode {
  const n = node as Partial<ElementNode>;
  return (
    typeof n.name === 'string' &&
    (n.type === 'tag' || n.type === 'script' || n.type === 'style') &&
    Array.isArray(n.children)
  );
}

function textData(node: DomNode): string | null {
  const n = node as { type?: unknown; data?: unknown };
  return n.type === 'text' && typeof n.data === 'string' ? n.data : null;
}

/** All text below a node, raw (for `pre`), skipping dropped elements. */
function rawText(nodes: DomNode[]): string {
  let out = '';
  for (const node of nodes) {
    const data = textData(node);
    if (data !== null) out += data;
    else if (isElement(node) && !DROPPED.has(node.name)) {
      out += node.name === 'br' ? '\n' : rawText(node.children);
    }
  }
  return out;
}

function isSecret(el: ElementNode): boolean {
  return (el.attribs.class ?? '').split(/\s+/).includes('secret');
}

/** Wrap inline content in a marker, keeping edge spaces outside it. */
function wrap(inner: string, marker: string): string {
  const core = inner.trim();
  if (core === '') return inner;
  const lead = /^\s/.test(inner) ? ' ' : '';
  const trail = /\s$/.test(inner) ? ' ' : '';
  return `${lead}${marker}${core}${marker}${trail}`;
}

class Converter {
  constructor(private readonly ctx: LinkContext) {}

  /** Inline Markdown for a run of nodes; `\n` marks a hard line break. */
  inline(nodes: DomNode[], depth: number): string {
    let out = '';
    for (const node of nodes) {
      const data = textData(node);
      if (data !== null) {
        out += rewriteText(data.replace(/\s+/g, ' '), this.ctx);
        continue;
      }
      if (!isElement(node) || DROPPED.has(node.name)) continue;
      if (depth > MAX_DEPTH) {
        out += escapeInlineText(rawText(node.children).replace(/\s+/g, ' '));
        continue;
      }
      out += this.inlineElement(node, depth + 1);
    }
    return out;
  }

  private inlineElement(el: ElementNode, depth: number): string {
    switch (el.name) {
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return wrap(this.inline(el.children, depth), '**');
      case 'em':
      case 'i':
        return wrap(this.inline(el.children, depth), '*');
      case 's':
      case 'del':
      case 'strike':
        return wrap(this.inline(el.children, depth), '~~');
      case 'img': {
        const alt = (el.attribs.alt ?? '').replace(/\s+/g, ' ').trim();
        return `\\[image${alt ? `: ${escapeInlineText(alt)}` : ''}\\]`;
      }
      case 'a': {
        const label = rawText(el.children).replace(/\s+/g, ' ').trim();
        const url = safeUrl(el.attribs.href ?? '');
        if (url && label) return `[${escapeInlineText(label)}](${url})`;
        return this.inline(el.children, depth);
      }
      case 'code':
        // Data never becomes a code span (plugins such as Dice Roller read them).
        return escapeInlineText(rawText(el.children).replace(/\s+/g, ' '));
      default:
        return BLOCKS.has(el.name)
          ? `\n${this.inline(el.children, depth)}\n`
          : this.inline(el.children, depth);
    }
  }

  /** Lines of one inline block: trimmed, empty lines dropped, starts escaped. */
  lines(inline: string): string[] {
    return inline
      .split('\n')
      .map(line => escapeLineStart(line.trim()))
      .filter(line => line !== '');
  }

  /** Markdown blocks for a run of nodes (joined later with blank lines). */
  blocks(nodes: DomNode[], depth: number): string[] {
    const out: string[] = [];
    let pending: DomNode[] = [];
    const flush = (): void => {
      const lines = this.lines(this.inline(pending, depth));
      if (lines.length > 0) out.push(lines.join('\n'));
      pending = [];
    };
    for (const node of nodes) {
      if (isElement(node) && DROPPED.has(node.name)) continue;
      if (isElement(node) && (BLOCKS.has(node.name) || isSecret(node))) {
        flush();
        out.push(...this.block(node, depth + 1));
      } else {
        pending.push(node);
      }
    }
    flush();
    return out;
  }

  private block(el: ElementNode, depth: number): string[] {
    if (depth > MAX_DEPTH) {
      const lines = this.lines(escapeInlineText(rawText(el.children)));
      return lines.length ? [lines.join('\n')] : [];
    }
    if (isSecret(el)) return [callout('> [!secret]- GM secret', this.blocks(el.children, depth))];
    if (HEADINGS.has(el.name)) {
      // Page notes have the page name as H1: content headings move one level down.
      const level = Math.min(6, Number(el.name.slice(1)) + 1);
      const text = this.lines(this.inline(el.children, depth)).join(' ');
      return text ? [`${'#'.repeat(level)} ${text}`] : [];
    }
    switch (el.name) {
      case 'p':
        return this.blocks(el.children, depth);
      case 'hr':
        return ['---'];
      case 'pre':
        return [fence(rawText(el.children))];
      case 'blockquote': {
        const inner = this.blocks(el.children, depth);
        return inner.length ? [quote(inner)] : [];
      }
      case 'ul':
      case 'ol':
        return this.list(el, depth);
      case 'table':
        return this.table(el, depth);
      default:
        return this.blocks(el.children, depth);
    }
  }

  private list(el: ElementNode, depth: number): string[] {
    const ordered = el.name === 'ol';
    const items: string[] = [];
    let n = 0;
    for (const child of el.children) {
      if (!isElement(child) || child.name !== 'li') continue;
      n += 1;
      const marker = ordered ? `${n}. ` : '- ';
      const indent = ' '.repeat(marker.length);
      const body = this.blocks(child.children, depth).join('\n');
      const lines = body === '' ? [''] : body.split('\n');
      items.push(
        lines
          .map((line, i) => (i === 0 ? `${marker}${line}` : line === '' ? '' : `${indent}${line}`))
          .join('\n')
      );
    }
    return items.length ? [items.join('\n')] : [];
  }

  private table(el: ElementNode, depth: number): string[] {
    const rows: ElementNode[] = [];
    const collect = (nodes: DomNode[]): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (node.name === 'tr') rows.push(node);
        else if (['thead', 'tbody', 'tfoot'].includes(node.name)) collect(node.children);
      }
    };
    collect(el.children);
    const cells = rows.map(row =>
      row.children.filter(
        (c): c is DomNode & ElementNode => isElement(c) && (c.name === 'td' || c.name === 'th')
      )
    );
    const simple =
      cells.length > 0 &&
      cells.every(row =>
        row.every(
          c =>
            c.attribs.colspan === undefined &&
            c.attribs.rowspan === undefined &&
            !c.children.some(n => isElement(n) && BLOCKS.has(n.name) && n.name !== 'p')
        )
      );
    if (!simple) return cells.flatMap(row => row.flatMap(c => this.blocks(c.children, depth)));
    const width = Math.max(...cells.map(row => row.length));
    const text = (c: ElementNode | undefined): string =>
      c ? this.lines(this.inline(c.children, depth)).join(' ') : '';
    const line = (row: ElementNode[]): string =>
      `| ${Array.from({ length: width }, (_, i) => text(row[i])).join(' | ')} |`;
    const [head = [], ...body] = cells;
    return [
      [
        line(head),
        `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
        ...body.map(line),
      ].join('\n'),
    ];
  }
}

function quote(blocks: string[]): string {
  return blocks
    .join('\n\n')
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function callout(head: string, blocks: string[]): string {
  return blocks.length ? `${head}\n${quote(blocks)}` : head;
}

/** A fenced block one backtick longer than any run inside; info string `text`. */
function fence(text: string): string {
  let longest = 2;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const f = '`'.repeat(longest + 1);
  const body = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  return `${f}text\n${body}\n${f}`;
}

function joinBlocks(blocks: string[]): string {
  return blocks
    .filter(b => b.trim() !== '')
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A page's HTML (`text.content`) as Markdown, links rewritten (section 5). */
export function htmlToMarkdown(html: string, ctx: LinkContext): string {
  const converter = new Converter(ctx);
  return joinBlocks(converter.blocks(parseDOM(html, { decodeEntities: true }), 0));
}

/**
 * A Markdown-format page (`text.markdown`): the same escaping and link rewrite,
 * not the HTML parser (design section 5). Line breaks and blank lines are kept;
 * the GM's own Markdown formatting shows as literal text.
 */
export function markdownPageText(markdown: string, ctx: LinkContext): string {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => escapeLineStart(rewriteText(line, ctx)));
  return joinBlocks([lines.join('\n')]);
}
