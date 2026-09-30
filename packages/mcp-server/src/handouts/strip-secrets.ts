/**
 * Secret blocks out of journal HTML, for the reveal copy (a handout copied
 * into the player journal "Handouts"). The copy is a Foundry page players open
 * in Foundry itself, so it must not carry the GM's secrets even in its source.
 *
 * What Foundry 14 treats as a secret (verified in the 14.368 client):
 * - `section.secret` blocks (the ProseMirror secret node, `secret-node.mjs`;
 *   `section.secret.revealed` is one the GM has shown, still a secret block),
 * - the `<secret-block>` element Foundry wraps them in when it renders.
 *
 * Removed here, with everything inside them: any element whose class list
 * holds `secret` (any tag, revealed or not), `<secret-block>`, and the GM-only
 * classes the dashboard sanitizer drops too (`gm-only`, `gmonly`, `gm-note`,
 * `gmnote`); HTML comments go as well (invisible, but still in the source).
 * The rest is kept as it was (this is not the player page sanitizer: the copy
 * keeps its formatting, images and links, like the page it copies).
 *
 * `prepareCopyHtml` (what a reveal copy stores) also neutralizes the Foundry
 * enrichers that pull other documents into the page when a player opens it,
 * because Foundry 14 resolves them on the player's client without a permission
 * check (verified in the 14.368 client, `text-editor.mjs`):
 * - `@Embed[...]` renders the target's content inline (`_embedContent` calls
 *   `toEmbed`, and `secrets=true` even shows the target's secret blocks), so
 *   every embed is dropped;
 * - a content link (`@UUID[...]`, `@Compendium[...]` and the legacy
 *   `@Actor[...]`, `@JournalEntry[...]` and so on) without a `{label}` shows the
 *   target's real name (`toAnchor` falls back to `this.name`), so a link to a
 *   document that is not a revealed handout becomes its label as plain text,
 *   or goes when it has none. Links to revealed handouts stay links.
 */
import { DomUtils, parseDocument } from 'htmlparser2';

type DomNode = ReturnType<typeof parseDocument>['children'][number];

/** Classes that mark GM-only content (same set as the dashboard's player sanitizer). */
const SECRET_CLASSES = new Set(['secret', 'gm-only', 'gmonly', 'gm-note', 'gmnote']);
/** Elements that are secrets by their tag name. */
const SECRET_TAGS = new Set(['secret-block']);

interface ElementLike {
  name: string;
  attribs: Record<string, string>;
  children: DomNode[];
}

function isElement(node: DomNode): node is DomNode & ElementLike {
  const n = node as Partial<ElementLike>;
  return typeof n.name === 'string' && Array.isArray(n.children);
}

function isComment(node: DomNode): boolean {
  return (node as { type?: unknown }).type === 'comment';
}

function isSecretElement(el: ElementLike): boolean {
  if (SECRET_TAGS.has(el.name.toLowerCase())) return true;
  const classes = (el.attribs.class ?? '').toLowerCase().split(/\s+/);
  return classes.some(c => SECRET_CLASSES.has(c));
}

/** Remove secret elements and comments below `nodes`; returns how many secrets went. */
function prune(nodes: DomNode[]): number {
  let removed = 0;
  // Iterate over a copy: removing a node changes its parent's children array.
  for (const node of [...nodes]) {
    if (isComment(node)) {
      DomUtils.removeElement(node);
    } else if (isElement(node)) {
      if (isSecretElement(node)) {
        DomUtils.removeElement(node);
        removed += 1;
      } else {
        removed += prune(node.children);
      }
    }
  }
  return removed;
}

export interface StrippedHtml {
  html: string;
  /** Secret blocks removed (outermost only: a secret inside a secret counts once). */
  removed: number;
}

/** `html` without secret blocks and comments; the rest serialized as it was. */
export function stripSecretBlocks(html: string): StrippedHtml {
  const doc = parseDocument(html);
  const removed = prune(doc.children);
  return { html: DomUtils.getOuterHTML(doc, { encodeEntities: 'utf8' }), removed };
}

/** `@Embed[config]{label}` as Foundry 14 matches it (`TextEditor._enrichEmbeds`, case-insensitive). */
const EMBED = /@Embed\[[^\]]+\](?:\{[^}]+\})?/gi;
/** `CONST.DOCUMENT_LINK_TYPES` plus `Compendium` and `UUID`, as `TextEditor._enrichContentLinks` uses them. */
const LINK_TYPES = [
  'Actor',
  'Cards',
  'Item',
  'Scene',
  'JournalEntry',
  'Macro',
  'RollTable',
  'PlaylistSound',
  'Compendium',
  'UUID',
];
/** `@Type[target#hash]{label}` as Foundry 14 matches a content link. */
const CONTENT_LINK = new RegExp(
  `@(${LINK_TYPES.join('|')})\\[([^#\\]]+)(?:#([^\\]]+))?\\](?:\\{([^}]+)\\})?`,
  'g'
);

export interface CopyHtml {
  html: string;
  /** Secret blocks removed (as in `stripSecretBlocks`). */
  secretsRemoved: number;
  /** `@Embed[...]` enrichers dropped. */
  embedsRemoved: number;
  /** Content links to documents that are not revealed handouts, turned into plain text. */
  linksUnlinked: number;
}

interface TextLike {
  type: string;
  data: string;
}

function isText(node: DomNode): node is DomNode & TextLike {
  const n = node as Partial<TextLike>;
  return n.type === 'text' && typeof n.data === 'string';
}

/** Rewrite embeds and content links in every text node below `nodes`. */
function neutralizeEnrichers(
  nodes: DomNode[],
  keepUuids: ReadonlySet<string>,
  counts: { embeds: number; links: number }
): void {
  for (const node of nodes) {
    if (isText(node)) {
      node.data = node.data
        .replace(EMBED, () => {
          counts.embeds += 1;
          return '';
        })
        .replace(
          CONTENT_LINK,
          (match: string, type: string, target: string, ...rest: unknown[]) => {
            if (type === 'UUID' && keepUuids.has(target)) return match;
            counts.links += 1;
            const label = rest[1];
            return typeof label === 'string' ? label : '';
          }
        );
    } else if (isElement(node)) {
      neutralizeEnrichers(node.children, keepUuids, counts);
    }
  }
}

/**
 * The HTML a reveal copy stores: no secret blocks or comments, no embeds, and
 * content links only to `keepUuids` (the revealed handouts); the rest as it was.
 */
export function prepareCopyHtml(html: string, keepUuids: ReadonlySet<string>): CopyHtml {
  const doc = parseDocument(html);
  const secretsRemoved = prune(doc.children);
  const counts = { embeds: 0, links: 0 };
  neutralizeEnrichers(doc.children, keepUuids, counts);
  return {
    html: DomUtils.getOuterHTML(doc, { encodeEntities: 'utf8' }),
    secretsRemoved,
    embedsRemoved: counts.embeds,
    linksUnlinked: counts.links,
  };
}
