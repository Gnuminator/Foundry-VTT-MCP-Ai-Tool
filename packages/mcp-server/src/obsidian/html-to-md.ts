/**
 * Journal page text to Markdown for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 5, Library additions in section 13). The HTML is parsed with htmlparser2 and Markdown
 * is REBUILT from an allowlist (headings, paragraphs, line breaks, bold, italic, strikethrough,
 * lists, blockquotes, tables, `pre`, rules); no raw HTML is ever written.
 * `section.secret` becomes a collapsed `[!secret]-` callout (the GM vault may hold
 * secrets, OBSIDIAN-PLAN decision 3). Book layouts get their own blocks: a D&D Beyond stat
 * block becomes a `[!statblock]` callout with a one-row ability table, read-aloud boxes a
 * `[!quote]` callout, sidebars a `[!note]` callout, tables real Markdown tables (spans
 * expanded). Images become an embed of the vault copy when the context has one, else
 * `[image: alt]`. Every text run goes through `links.ts` (Foundry links and enrichers
 * rewritten, the rest escaped), and every output line's start is escaped before we add our
 * own block markers.
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

/** Class of the D&D Beyond stat block container (books and monster pages). */
const STAT_BLOCK_CLASS = /^(stat-block-finder|mon-stat-block|stat-block)$/;
const MAX_COLSPAN = 20;
const MAX_ROWSPAN = 100;
const MAX_COLUMNS = 30;
const ABILITY_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

function hasClass(el: ElementNode, pattern: RegExp): boolean {
  return (el.attribs.class ?? '').split(/\s+/).some(name => pattern.test(name));
}

function spanOf(value: string | undefined, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, max) : 1;
}

/**
 * The six ability scores as a one-row Markdown table, read from the text of a stat block's
 * ability area (`STR 16 (+3) DEX 14 (+2) ...`, any markup). Null unless all six are found.
 */
export function abilityTable(text: string): string | null {
  const found = new Map<string, string>();
  const pattern =
    /(?<![A-Za-z])(STR|DEX|CON|INT|WIS|CHA)(?![A-Za-z])\s*(\d{1,2})\s*\(\s*([+−–-]?\s*\d{1,2})\s*\)/gi;
  for (const match of text.matchAll(pattern)) {
    const key = (match[1] ?? '').toUpperCase();
    if (!found.has(key)) {
      const mod = (match[3] ?? '').replace(/\s+/g, '').replace(/[−–]/, '-');
      found.set(key, `${match[2]} (${/^[+-]/.test(mod) ? mod : `+${mod}`})`);
    }
  }
  if (!ABILITY_ORDER.every(key => found.has(key))) return null;
  return [
    `| ${ABILITY_ORDER.join(' | ')} |`,
    `| ${ABILITY_ORDER.map(() => ':-:').join(' | ')} |`,
    `| ${ABILITY_ORDER.map(key => found.get(key) ?? '').join(' | ')} |`,
  ].join('\n');
}

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
      case 'img':
        return this.image(el.attribs.src ?? '', el.attribs.alt ?? '');
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

  /** The vault copy of an image as an embed, else `[image: alt]`. */
  image(src: string, altRaw: string): string {
    const alt = altRaw.replace(/\s+/g, ' ').trim();
    const embed = src.trim() ? (this.ctx.image?.(src.trim(), alt) ?? null) : null;
    if (embed !== null) return `\n${embed}\n`;
    return `\\[image${alt ? `: ${escapeInlineText(alt)}` : ''}\\]`;
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
    if (hasClass(el, STAT_BLOCK_CLASS)) return this.statBlock(el, depth);
    if (hasClass(el, /^read-aloud-text$|Boxed-Text/)) {
      return [callout('> [!quote] Read aloud', this.blocks(el.children, depth))];
    }
    if (el.name === 'aside' || hasClass(el, /sidebar|block-torn-paper|text--rules/i)) {
      return [callout('> [!note]', this.blocks(el.children, depth))];
    }
    if (el.name === 'figure') return this.figure(el, depth);
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
    const captions: string[] = [];
    const collect = (nodes: DomNode[]): void => {
      for (const node of nodes) {
        if (!isElement(node)) continue;
        if (node.name === 'tr') rows.push(node);
        else if (node.name === 'caption') captions.push(this.cellText(node, depth));
        else if (['thead', 'tbody', 'tfoot'].includes(node.name)) collect(node.children);
      }
    };
    collect(el.children);
    const caption = captions.filter(text => text !== '').join(' ');
    // A grid with column and row spans expanded (the spanned cells stay empty).
    const grid: string[][] = [];
    rows.forEach((row, r) => {
      const line = (grid[r] ??= []);
      let c = 0;
      for (const cell of row.children) {
        if (!isElement(cell) || (cell.name !== 'td' && cell.name !== 'th')) continue;
        while (line[c] !== undefined) c++;
        const colspan = spanOf(cell.attribs.colspan, MAX_COLSPAN);
        const rowspan = Math.min(spanOf(cell.attribs.rowspan, MAX_ROWSPAN), rows.length - r);
        const text = this.cellText(cell, depth);
        for (let dr = 0; dr < rowspan; dr++) {
          const target = (grid[r + dr] ??= []);
          for (let dc = 0; dc < colspan; dc++) {
            target[c + dc] = dr === 0 && dc === 0 ? text : '';
          }
        }
        c += colspan;
      }
    });
    const width = Math.min(MAX_COLUMNS, Math.max(0, ...grid.map(row => row.length)));
    if (width === 0) return caption ? [`**${caption}**`] : [];
    const line = (row: string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
    const [head = [], ...body] = grid;
    const table = [
      line(head),
      `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
      ...body.map(line),
    ].join('\n');
    return caption ? [`**${caption}**`, table] : [table];
  }

  /** One table cell (or caption) as a single line; a wikilink's `|` escaped for the table. */
  private cellText(cell: ElementNode, depth: number): string {
    return this.blocks(cell.children, depth)
      .join(' ')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .join(' ')
      .replace(/(!?\[\[[^\]|]*)\|/g, '$1\\|');
  }

  /** A figure: its image(s), then the caption in italics. */
  private figure(el: ElementNode, depth: number): string[] {
    const caption = el.children.find(
      (n): n is DomNode & ElementNode => isElement(n) && n.name === 'figcaption'
    );
    const rest = el.children.filter(n => n !== caption);
    const out = this.blocks(rest, depth);
    if (caption) {
      const text = this.lines(this.inline(caption.children, depth)).join(' ');
      if (text) out.push(`*${text}*`);
    }
    return out;
  }

  /**
   * A D&D Beyond stat block (`div.stat-block-finder` with `Stat-Block-Styles_*` paragraphs):
   * a `[!statblock]` callout titled with the creature (a link when the title is one), the
   * metadata line in italics, the data lines (AC, HP, Speed, ...) as one block of lines, the
   * six ability scores as a one-row table, then traits and actions with their headings.
   */
  private statBlock(el: ElementNode, depth: number): string[] {
    let title = '';
    const blocks: string[] = [];
    let data: string[] = [];
    const flushData = (): void => {
      if (data.length) blocks.push(data.join('\n'));
      data = [];
    };
    const visit = (nodes: DomNode[]): void => {
      for (const node of nodes) {
        if (!isElement(node)) {
          const text = textData(node);
          if (text !== null && text.trim() !== '') {
            flushData();
            blocks.push(...this.blocks([node], depth));
          }
          continue;
        }
        if (DROPPED.has(node.name)) continue;
        const cls = node.attribs.class ?? '';
        const inlineText = (): string => this.lines(this.inline(node.children, depth)).join(' ');
        if (/Stat-Block-Title|stat-block__name|mon-stat-block__name/i.test(cls)) {
          title = title || inlineText();
        } else if (/Stat-Block-Metadata|stat-block__meta|mon-stat-block__meta/i.test(cls)) {
          flushData();
          const text = inlineText();
          if (text) blocks.push(`*${text}*`);
        } else if (/ability-scores|ability-block/i.test(cls)) {
          flushData();
          const table = abilityTable(rawText(node.children));
          if (table) blocks.push(table);
          else blocks.push(...this.blocks(node.children, depth));
        } else if (/Stat-Block-Data|stat-block__attribute|tidbit/i.test(cls)) {
          const text = inlineText();
          if (text) data.push(text);
        } else if (/Stat-Block-Heading|stat-block__heading|block-heading/i.test(cls)) {
          flushData();
          const text = inlineText();
          if (text) blocks.push(`### ${text}`);
        } else if (node.name === 'div' && !/Stat-Block/i.test(cls)) {
          visit(node.children);
        } else {
          flushData();
          blocks.push(...this.blocks([node], depth));
        }
      }
    };
    visit(el.children);
    flushData();
    return [callout(`> [!statblock] ${title || 'Stat block'}`, blocks)];
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
