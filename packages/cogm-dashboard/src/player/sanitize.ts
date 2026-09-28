import { parseDOM } from 'htmlparser2';

/**
 * Server-side sanitizer for handouts on the player page (M2).
 *
 * A revealed journal page is GM-authored Foundry HTML. What reaches a player is
 * rebuilt from an allowlist, never cleaned by removing known-bad parts:
 *
 * - Only simple formatting tags survive, with **no attributes at all** (no
 *   links, styles, classes, ids, event handlers or image sources).
 * - GM secret blocks (`section.secret`, anything classed `secret`/`gm-only`)
 *   and active or embedded content (scripts, styles, frames, images, media,
 *   forms, SVG) are dropped with everything inside them.
 * - Unknown tags are unwrapped: their text stays, the tag goes.
 * - Foundry text syntax is resolved before it can reach a player: a content
 *   link (`@UUID[...]{label}`, `@JournalEntry[...]{...}`, ...) keeps its label
 *   only when it points at another revealed page, else it is dropped with its
 *   label (a label can be the spoiler); inline rolls (`[[...]]`) are dropped;
 *   other enrichers (`@Check[...]{label}`) keep only their label; `@Embed`
 *   and `@Lookup` (they pull in other documents' data) are dropped.
 */

type DomNode = ReturnType<typeof parseDOM>[number];

interface ElementNode {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

interface TextNode {
  data: string;
}

/** Tags kept (without attributes). */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'sup',
  'sub',
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
  'th',
  'td',
  'code',
  'pre',
]);

const VOID_TAGS = new Set(['br', 'hr']);

/** Tags dropped together with everything inside them. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'template',
  'noscript',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'img',
  'picture',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'link',
  'meta',
  'base',
  'head',
  'title',
]);

/** Classes that mark GM-only content (Foundry's secret blocks and common module variants). */
const SECRET_CLASSES = new Set(['secret', 'gm-only', 'gmonly', 'gm-note', 'gmnote']);

const MAX_DEPTH = 64;
const MAX_OUTPUT = 200_000;

/** Enricher syntax `@Type[target]{label}`; label optional. */
const ENRICHER = /@([A-Za-z]+)\[([^\]]*)\](?:\{([^}]*)\})?/g;
/** Inline rolls `[[...]]` (immediate, deferred, `/r` commands), with an optional `{label}`. */
const INLINE_ROLL = /\[\[[^\]]*\]\](?:\{[^}]*\})?/g;
/** Enrichers that link to a document (the target decides whether the label may show). */
const LINK_ENRICHERS = new Set([
  'UUID',
  'Actor',
  'Item',
  'JournalEntry',
  'JournalEntryPage',
  'Scene',
  'RollTable',
  'Macro',
  'Cards',
  'Playlist',
  'Compendium',
]);
/** Enrichers dropped outright: they pull in other documents' content or data. */
const DROPPED_ENRICHERS = new Set(['Embed', 'Lookup']);

function isElement(node: DomNode): node is DomNode & ElementNode {
  const n = node as Partial<ElementNode>;
  return typeof n.name === 'string' && Array.isArray(n.children);
}

function isText(node: DomNode): node is DomNode & TextNode {
  const n = node as { type?: unknown; data?: unknown };
  return n.type === 'text' && typeof n.data === 'string';
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasSecretClass(el: ElementNode): boolean {
  const cls = el.attribs.class ?? '';
  return cls.split(/\s+/).some(c => SECRET_CLASSES.has(c.toLowerCase()));
}

/** The page uuid a link target names, when it names one (`JournalEntry.x.JournalEntryPage.y`). */
function pageUuidOf(type: string, target: string): string | null {
  const t = target.split('#')[0]?.trim() ?? '';
  if (type === 'UUID' || type === 'JournalEntryPage') {
    return /^JournalEntry\.[A-Za-z0-9]+\.JournalEntryPage\.[A-Za-z0-9]+$/.test(t) ? t : null;
  }
  return null;
}

/** Resolve Foundry text syntax in one text node (see the file comment). */
export function resolveFoundrySyntax(text: string, revealed: ReadonlySet<string>): string {
  return text
    .replace(INLINE_ROLL, '')
    .replace(ENRICHER, (_m, type: string, target: string, label?: string) => {
      if (DROPPED_ENRICHERS.has(type)) return '';
      if (LINK_ENRICHERS.has(type)) {
        const page = pageUuidOf(type, target);
        return page && revealed.has(page) && label ? label : '';
      }
      return label ?? '';
    });
}

/**
 * Sanitize a revealed page's HTML for the player page. `revealedUuids`: every
 * page uuid on the reveal allowlist (links to them keep their label).
 */
export function sanitizeHandoutHtml(html: string, revealedUuids: Iterable<string>): string {
  const revealed = new Set(revealedUuids);
  const nodes = parseDOM(html, { decodeEntities: true, lowerCaseTags: true });
  let out = '';
  const emit = (list: DomNode[], depth: number): void => {
    for (const node of list) {
      if (out.length > MAX_OUTPUT) return;
      if (isText(node)) {
        out += escapeText(resolveFoundrySyntax(node.data, revealed));
        continue;
      }
      if (!isElement(node)) continue; // comments, directives, CDATA
      if (depth >= MAX_DEPTH) continue;
      const name = node.name.toLowerCase();
      if (DROPPED_TAGS.has(name) || hasSecretClass(node)) continue;
      if (ALLOWED_TAGS.has(name)) {
        if (VOID_TAGS.has(name)) {
          out += `<${name}>`;
          continue;
        }
        out += `<${name}>`;
        emit(node.children, depth + 1);
        out += `</${name}>`;
      } else {
        emit(node.children, depth + 1); // unwrap unknown tags (a, span, div, section, ...)
      }
    }
  };
  emit(nodes, 0);
  // No slicing at the cap: emitting stops between nodes, so tags and entities stay whole.
  return out;
}
