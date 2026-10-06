/**
 * Foundry link syntax in page text, rewritten for Obsidian
 * (docs/design/OBSIDIAN-O4-DESIGN.md section 5, Library additions in section 13). Patterns
 * follow Foundry 14.368 and dnd5e 6.0.5:
 * - content links `@(Actor|Cards|Item|Scene|JournalEntry|Macro|RollTable|PlaylistSound|Compendium|UUID)[target#hash]{label}`
 *   (`client/applications/ux/text-editor.mjs:203-204`, types `common/constants.mjs:515-516`);
 * - embeds `@Embed[config]{label}` (`text-editor.mjs:218`, case-insensitive);
 * - inline rolls `[[/r ...]]` / `[[...]]` (`text-editor.mjs:249`) and the dnd5e
 *   enrichers `[[/check ...]]`, `[[/save ...]]`, `[[/damage ...]]`, `[[lookup ...]]`,
 *   `&Reference[...]` (`dnd5e.mjs:31931-31946`), plus the older `@Check[...]` style;
 * - relative uuids (`.P`, `..X`) as `common/utils/helpers.mjs:1380-1440` resolves them.
 *
 * Nothing is ever shown as a raw code: a link becomes a link to the matching mirror or Library
 * note, else the label as an "Open in Foundry" link, else the plain label; rolls and checks
 * become the words Foundry's button shows (`dnd5e-text.ts`). Everything that is not a link we
 * emit goes through `escapeInlineText`; the caller escapes line starts when it builds blocks.
 */
import { isFoundryUuid } from '@gnuminator/shared';

import { atEnricherText, inlineRollText, referenceText } from './dnd5e-text.js';
import { escapeInlineText, escapeLinkLabel, safeUrl } from './md-escape.js';
import { openUrl, relativeLinkTarget, type LinkContext, type LinkTarget } from './mirror-common.js';

const LINK_TYPES = 'Actor|Cards|Item|Scene|JournalEntry|Macro|RollTable|PlaylistSound';
const AT_ENRICHERS = 'Check|Save|Skill|Tool|Damage|Attack|Heal';
/** One scanner for every construct, left to right (named groups per construct). */
const TOKEN = new RegExp(
  [
    `@(?<ltype>${LINK_TYPES}|Compendium|UUID)\\[(?<ltarget>[^#\\]]+)(?:#[^\\]]*)?\\](?:\\{(?<llabel>[^}]*)\\})?`,
    '@[Ee][Mm][Bb][Ee][Dd]\\[(?<econfig>[^\\]]+)\\](?:\\{(?<elabel>[^}]*)\\})?',
    `@(?<atype>${AT_ENRICHERS})\\[(?<aconfig>[^\\]]*)\\](?:\\{(?<alabel>[^}]*)\\})?`,
    '@(?<otype>[A-Z][A-Za-z]+)\\[(?<oconfig>[^\\]]*)\\](?:\\{(?<olabel>[^}]*)\\})?',
    '(?<roll>\\[\\[(?:\\/[a-zA-Z]+\\s?)?.*?\\]{2,3}(?:\\{[^}]*\\})?)',
    '&Reference\\[(?<rconfig>[^\\]]+)\\](?:\\{(?<rlabel>[^}]*)\\})?',
    '(?<url>https?:\\/\\/[^\\s<>"\'`\\[\\]()]+)',
  ].join('|'),
  'g'
);
const DOC_ID = /^[A-Za-z0-9]{16}$/;
/** A usable `/open` base: an origin without characters that would break a link. */
const OPEN_BASE = /^https?:\/\/[^\s()<>]+$/;

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

/** The label as an "Open in Foundry" link when the dashboard base is set, else plain text. */
function openLink(text: string, uuid: string, ctx: LinkContext): string {
  if (!OPEN_BASE.test(ctx.openBase) || !isFoundryUuid(uuid)) return text;
  return `[${text}](${openUrl(ctx.openBase, uuid)})`;
}

/** `Compendium.pkg.pack.Type.id` (embedded parts dropped), or null. */
function compendiumDocUuid(uuid: string): string | null {
  const parts = uuid.split('.');
  if (parts.length < 5) return null;
  const top = parts.slice(0, 5).join('.');
  return isFoundryUuid(top) ? top : null;
}

/** A compendium document: its Library note when there is one, else an Open in Foundry link. */
function compendiumLink(uuid: string, label: string | null, ctx: LinkContext): string {
  const top = compendiumDocUuid(uuid);
  // A compendium actor that stands for a world NPC links that NPC's note (the user's rule,
  // 2026-10-06): the world copy is the one the GM runs.
  const worldUuid = top ? (ctx.worldActor?.(top) ?? null) : null;
  const world = worldUuid ? ctx.resolve(worldUuid) : null;
  if (world?.notePath) {
    const shown = escapeLinkLabel(label ?? world.name ?? uuid.split('.').pop() ?? uuid);
    return `[${shown}](${relativeLinkTarget(ctx.fromPath, world.notePath, world.blockId)})`;
  }
  const library = top ? (ctx.library?.byUuid(top) ?? null) : null;
  const idLabel = uuid.split('.').pop() ?? uuid;
  const text = escapeLinkLabel(label ?? library?.name ?? idLabel);
  if (library?.notePath) return `[${text}](${relativeLinkTarget(ctx.fromPath, library.notePath)})`;
  return top ? openLink(text, top, ctx) : text;
}

/**
 * A typeless or legacy compendium id read as an actor that stands for a world NPC (the module
 * resolved it from the pack itself), so the link works without the Library; else null.
 */
function asWorldActor(pkg: string, pack: string, id: string, ctx: LinkContext): string | null {
  if (!DOC_ID.test(id)) return null;
  const uuid = `Compendium.${pkg}.${pack}.Actor.${id}`;
  return ctx.worldActor?.(uuid) ? uuid : null;
}

/** A link we write: to a note, to `/open`, or the plain label. Never a raw uuid. */
function linkTo(uuid: string, label: string | null, ctx: LinkContext): string {
  const idLabel = uuid.split('.').pop() ?? uuid;
  if (uuid.startsWith('Compendium.')) {
    if (compendiumDocUuid(uuid) === null) {
      // A typeless compendium uuid (`Compendium.pkg.pack.id`): the Library knows the pack type.
      const parts = uuid.split('.');
      const full =
        parts.length === 4
          ? (ctx.library?.legacy(`${parts[1]}.${parts[2]}`, parts[3] ?? '') ??
            asWorldActor(parts[1] ?? '', parts[2] ?? '', parts[3] ?? '', ctx))
          : null;
      if (full) return compendiumLink(full, label, ctx);
      return escapeLinkLabel(label ?? idLabel);
    }
    return compendiumLink(uuid, label, ctx);
  }
  if (!isFoundryUuid(uuid)) return escapeLinkLabel(label ?? 'link');
  const parts = uuid.split('.');
  // Pages resolve on their own; any other embedded document goes to its parent's note.
  const target =
    parts[0] === 'JournalEntry' && parts[2] === 'JournalEntryPage'
      ? parts.slice(0, 4).join('.')
      : parts.slice(0, 2).join('.');
  const found: LinkTarget | null = ctx.resolve(target);
  const shown = label ?? (target === uuid ? found?.name : null) ?? found?.name ?? idLabel;
  const text = escapeLinkLabel(shown);
  if (found === null) return text;
  if (found.notePath === null) return openLink(text, target, ctx);
  const href = relativeLinkTarget(ctx.fromPath, found.notePath, found.blockId);
  return `[${text}](${href})`;
}

/** A label that only says "open it" (`Open RollTable`): the target's name reads better. */
function usefulLabel(label: string | null, target: string): string {
  if (label?.trim() && !/^open\b/i.test(label.trim())) return label;
  return target;
}

function contentLink(type: string, target: string, label: string | null, ctx: LinkContext): string {
  const t = target.trim();
  if (type === 'UUID') {
    const uuid = t.startsWith('.') ? resolveRelativeUuid(t, ctx.pageUuid) : t;
    return uuid === null ? escapeLinkLabel(label ?? 'link') : linkTo(uuid, label, ctx);
  }
  if (type === 'Compendium') {
    // Legacy `@Compendium[pkg.pack.idOrName]`: the Library knows the pack's document type.
    const match = /^([\w-]+\.[\w-]+)\.(.+)$/.exec(t);
    const collection = match?.[1] ?? '';
    const full = match
      ? (ctx.library?.legacy(collection, match[2] ?? '') ??
        asWorldActor(
          collection.split('.')[0] ?? '',
          collection.split('.')[1] ?? '',
          match[2] ?? '',
          ctx
        ))
      : null;
    if (full) return compendiumLink(full, label, ctx);
    const name = match && !DOC_ID.test(match[2] ?? '') ? (match[2] ?? null) : null;
    return escapeLinkLabel(label ?? name ?? 'compendium entry');
  }
  if (DOC_ID.test(t)) return linkTo(`${type}.${t}`, label, ctx);
  const uuid = ctx.findByName?.(type, t) ?? null;
  if (uuid !== null) return linkTo(uuid, label, ctx);
  // An unknown name (a roll table that lives in a compendium, a deleted actor): the words.
  return escapeLinkLabel(usefulLabel(label, t));
}

/** `@Embed[uuid inline ...]` or `@Embed[uuid=... ...]`: the uuid is the first token. */
function embedLink(config: string, label: string | null, ctx: LinkContext): string {
  const first = config.trim().split(/\s+/)[0] ?? '';
  const raw = first.startsWith('uuid=') ? first.slice(5) : first;
  const uuid = raw.startsWith('.') ? resolveRelativeUuid(raw, ctx.pageUuid) : raw;
  return `Embedded: ${uuid ? linkTo(uuid, label, ctx) : escapeLinkLabel(label ?? 'document')}`;
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
 * escaped, Foundry links rewritten, inline rolls and dnd5e enrichers as words.
 */
export function rewriteText(text: string, ctx: LinkContext): string {
  let out = '';
  let last = 0;
  const words = { selfName: ctx.selfName ?? null };
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    out += escapeInlineText(text.slice(last, index));
    last = index + match[0].length;
    const g = match.groups ?? {};
    const none = (value: string | undefined): string | null =>
      value !== undefined && value.trim() !== '' ? value : null;
    if (g.ltype && g.ltarget) out += contentLink(g.ltype, g.ltarget, none(g.llabel), ctx);
    else if (g.econfig) out += embedLink(g.econfig, none(g.elabel), ctx);
    else if (g.atype) {
      out += escapeInlineText(atEnricherText(g.atype, g.aconfig ?? '', none(g.alabel)));
    } else if (g.otype) {
      // Another module's enricher (`@Template[...]`, `@Award[...]`): its label or its words.
      out += escapeInlineText(none(g.olabel) ?? (g.oconfig ?? '').replace(/[|=]/g, ' ').trim());
    } else if (g.roll) out += escapeInlineText(inlineRollText(g.roll, words));
    else if (g.rconfig) out += escapeInlineText(referenceText(g.rconfig, none(g.rlabel)));
    else if (g.url) out += bareUrl(g.url);
    else out += escapeInlineText(match[0]);
  }
  return out + escapeInlineText(text.slice(last));
}
