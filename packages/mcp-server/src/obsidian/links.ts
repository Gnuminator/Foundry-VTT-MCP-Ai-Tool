/**
 * Foundry link syntax in page text, rewritten for Obsidian
 * (docs/OBSIDIAN-O4-DESIGN.md section 5). Patterns follow Foundry 14.368 and
 * dnd5e 6.0.5:
 * - content links `@(Actor|Cards|Item|Scene|JournalEntry|Macro|RollTable|PlaylistSound|Compendium|UUID)[target#hash]{label}`
 *   (`client/applications/ux/text-editor.mjs:203-204`, types `common/constants.mjs:515-516`);
 * - embeds `@Embed[config]{label}` (`text-editor.mjs:218`, case-insensitive);
 * - inline rolls `[[/r ...]]` / `[[...]]` (`text-editor.mjs:249`) and the dnd5e
 *   enrichers `[[/check ...]]`, `[[lookup ...]]`, `&Reference[...]`
 *   (`dnd5e.mjs:31931-31946`);
 * - relative uuids (`.P`, `..X`) as `common/utils/helpers.mjs:1380-1440` resolves them.
 * Everything that is not a link we emit goes through `escapeInlineText`; the
 * caller escapes line starts when it builds blocks.
 */
import { isFoundryUuid } from '@gnuminator/shared';

import { codeSpan, escapeInlineText, escapeLinkLabel, safeUrl } from './md-escape.js';
import { openUrl, relativeLinkTarget, type LinkContext, type LinkTarget } from './mirror-common.js';

const LINK_TYPES = 'Actor|Cards|Item|Scene|JournalEntry|Macro|RollTable|PlaylistSound';
/** One scanner for every construct, left to right (named groups per construct). */
const TOKEN = new RegExp(
  [
    `@(?<ltype>${LINK_TYPES}|Compendium|UUID)\\[(?<ltarget>[^#\\]]+)(?:#[^\\]]+)?\\](?:\\{(?<llabel>[^}]+)\\})?`,
    '@[Ee][Mm][Bb][Ee][Dd]\\[(?<econfig>[^\\]]+)\\](?:\\{(?<elabel>[^}]+)\\})?',
    '(?<roll>\\[\\[(?:\\/[a-zA-Z]+\\s)?.*?\\]{2,3}(?:\\{[^}]+\\})?)',
    '(?<ref>&Reference\\[[^\\]]+\\](?:\\{[^}]+\\})?)',
    '(?<url>https?:\\/\\/[^\\s<>"\'`\\[\\]()]+)',
  ].join('|'),
  'g'
);
const DOC_ID = /^[A-Za-z0-9]{16}$/;

/** `JournalEntry.J.JournalEntryPage.P` -> [['JournalEntry','J'], ['JournalEntryPage','P']]. */
function pairsOf(uuid: string): Array<[string, string]> | null {
  const parts = uuid.split('.');
  if (parts.length < 2 || parts.length % 2 !== 0) return null;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < parts.length; i += 2) pairs.push([parts[i] ?? '', parts[i + 1] ?? '']);
  return pairs;
}

/**
 * Resolve a relative uuid (`.P`, `..X`, `.Type.id`) against the document it
 * appears in, the way Foundry does (`helpers.mjs:1380-1440`). Returns the
 * absolute uuid, or null when it climbs past the root.
 */
export function resolveRelativeUuid(relative: string, baseUuid: string): string | null {
  const chain = pairsOf(baseUuid);
  if (!chain) return null;
  let k = 1;
  while (relative.at(k) === '.') k++;
  const rest = relative.substring(k);
  let depth = chain.length;
  while (--k && depth > 0) depth--;
  if (depth === 0) return null;
  const current = chain.slice(0, depth);
  const flat = (pairs: Array<[string, string]>): string[] => pairs.flat();
  if (!rest) return flat(current).join('.');
  const parts = rest.split('.');
  const root = current[0];
  if (!root) return null;
  if (parts.length % 2 === 0) return [...flat(current), ...parts].join('.');
  if (current.length > 1) {
    const self = current[current.length - 1];
    if (!self) return null;
    return [...flat(current.slice(0, -1)), self[0], ...parts].join('.');
  }
  if (parts.length > 1) return [root[0], ...parts].join('.');
  return [root[0], parts[0] ?? ''].join('.');
}

/** A link we write: to a note, to `/open`, or a label with the uuid as code. */
function linkTo(uuid: string, label: string | null, ctx: LinkContext): string {
  const idLabel = uuid.split('.').pop() ?? uuid;
  if (uuid.startsWith('Compendium.')) {
    const text = escapeLinkLabel(label ?? idLabel);
    // A compendium uuid needs its document type (`Compendium.pkg.pack.Type.id`).
    return isFoundryUuid(uuid) && uuid.split('.').length >= 5
      ? `[${text}](${openUrl(ctx.openBase, uuid)})`
      : `${text} ${codeSpan(uuid)}`;
  }
  if (!isFoundryUuid(uuid)) return escapeInlineText(label ?? uuid);
  const parts = uuid.split('.');
  // Pages resolve on their own; any other embedded document goes to its parent's note.
  const target =
    parts[0] === 'JournalEntry' && parts[2] === 'JournalEntryPage'
      ? parts.slice(0, 4).join('.')
      : parts.slice(0, 2).join('.');
  const found: LinkTarget | null = ctx.resolve(target);
  const shown = label ?? (target === uuid ? found?.name : null) ?? idLabel;
  if (found === null) return `${escapeLinkLabel(shown)} ${codeSpan(`${target} (not found)`)}`;
  if (found.notePath === null) return `${escapeLinkLabel(shown)} ${codeSpan(target)}`;
  const href = relativeLinkTarget(ctx.fromPath, found.notePath, found.blockId);
  return `[${escapeLinkLabel(shown)}](${href})`;
}

/** The uuid a content link names, or null (legacy compendium links, unknown names). */
function contentLinkUuid(type: string, target: string, ctx: LinkContext): string | null {
  const t = target.trim();
  if (type === 'UUID') return t.startsWith('.') ? resolveRelativeUuid(t, ctx.pageUuid) : t;
  if (type === 'Compendium') return null;
  if (DOC_ID.test(t)) return `${type}.${t}`;
  return ctx.findByName?.(type, t) ?? null;
}

function contentLink(type: string, target: string, label: string | null, ctx: LinkContext): string {
  const uuid = contentLinkUuid(type, target, ctx);
  if (uuid !== null) return linkTo(uuid, label, ctx);
  // Legacy `@Compendium[pkg.pack.id]`, an unknown name, a relative uuid past the root.
  return `${escapeLinkLabel(label ?? target)} ${codeSpan(`@${type}[${target}]`)}`;
}

/** `@Embed[uuid inline ...]` or `@Embed[uuid=... ...]`: the uuid is the first token. */
function embedLink(config: string, label: string | null, ctx: LinkContext): string {
  const first = config.trim().split(/\s+/)[0] ?? '';
  const raw = first.startsWith('uuid=') ? first.slice(5) : first;
  const uuid = raw.startsWith('.') ? resolveRelativeUuid(raw, ctx.pageUuid) : raw;
  return `Embedded: ${uuid ? linkTo(uuid, label, ctx) : escapeInlineText(label ?? config)}`;
}

/** A bare URL: a link only for http(s); trailing punctuation stays text. */
function bareUrl(url: string): string {
  const trail = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
  const core = url.slice(0, url.length - trail.length);
  const safe = safeUrl(core);
  const text = safe ? `[${escapeLinkLabel(core)}](${safe})` : escapeInlineText(core);
  return text + escapeInlineText(trail);
}

/**
 * One text run from a page (entities already decoded) as Markdown: plain parts
 * escaped, Foundry links rewritten, inline rolls and dnd5e enrichers as code.
 */
export function rewriteText(text: string, ctx: LinkContext): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    out += escapeInlineText(text.slice(last, index));
    last = index + match[0].length;
    const g = match.groups ?? {};
    if (g.ltype && g.ltarget) out += contentLink(g.ltype, g.ltarget, g.llabel ?? null, ctx);
    else if (g.econfig) out += embedLink(g.econfig, g.elabel ?? null, ctx);
    else if (g.roll) out += codeSpan(g.roll);
    else if (g.ref) out += codeSpan(g.ref);
    else if (g.url) out += bareUrl(g.url);
    else out += escapeInlineText(match[0]);
  }
  return out + escapeInlineText(text.slice(last));
}
