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
