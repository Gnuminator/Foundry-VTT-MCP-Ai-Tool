/**
 * Notes, bases and the status note of the Foundry mirror (docs/design/OBSIDIAN-O4-DESIGN.md
 * section 3, Obsidian O4). Pure functions: an `ExportEntry` (from the module query
 * `getExportIndex`) plus a `MirrorRenderContext` (paths and links the pump resolved)
 * in, Markdown out. Output is deterministic (no clock), so an unchanged note is not
 * rewritten while the GM has it open.
 *
 * Everything rendered lands in the GM's own vault and carries GM-only data (hidden NPCs,
 * GM journals). `player_visible` is advisory for the GM ("a player can open this in
 * Foundry's UI"), never a filter: nothing here decides what a player may see.
 *
 * Inert data. Names, labels, paths and text come from Foundry and can be hostile, and the
 * GM's vault runs Templater and renders wikilinks in properties:
 * - properties: every string goes through `propText` (one line, 200 characters, `[[` and
 *   `]]` broken up, because Obsidian renders a quoted `[[..]]` in a property as a live
 *   link); only `propertyWikilink` writes a wikilink, and only for a path we allocated;
 * - bodies: every label goes through `escapeMd` (Markdown punctuation escaped, `<` as
 *   `&lt;`, one line), links are relative Markdown links with percent-encoded paths, and
 *   paths shown as text go into `codeSpan` with a long enough fence;
 * - `<%` never survives `withGeneratedHash` (the one Templater choke point).
 *
 * Property order (section 3.2): `type`, `fvtt_world`, `fvtt_uuid`, `fvtt_type`, `name`,
 * `folder`, the type's own properties, `aliases`, `fvtt_modified`, `fvtt_sig`,
 * `player_access`, `player_visible`, `rules`, `schema`, `tags`, `generated_by`,
 * `generated_hash` (last). That order cannot be built with `generatedProps` (it puts
 * `fvtt_modified` right before `player_visible`), so `mirrorProps` below builds it; the
 * status note, which has no Foundry document behind it, does use `generatedProps`.
 */
import {
  EXPORT_INDEX_LIMITS,
  isFoundryUuid,
  type ExportActorEntry,
  type ExportEntry,
  type ExportItemEntry,
  type ExportJournalEntry,
  type ExportPageEntry,
  type ExportSceneEntry,
  type PlayerAccess,
  type RulesTag,
} from '@gnuminator/shared';

import { htmlToMarkdown, markdownPageText } from './html-to-md.js';
import {
  MIRROR_NOTE_TYPES,
  MIRROR_ROOT,
  MIRROR_STATUS_PATH,
  openUrl,
  propertyWikilink,
  relativeLinkTarget,
  type LinkContext,
  type LinkTarget,
  type MirrorNoteType,
  type MirrorRenderContext,
  type MirrorStatus,
  type RenderedNote,
} from './mirror-common.js';
import { GENERATED_BY, renderBaseText, withGeneratedHash } from './ownership.js';
import { frontmatter, generatedProps } from './render.js';
import { statBlockMarkdown } from './stat-block-md.js';

// ---------------------------------------------------------------------------
// Shapes and constants
// ---------------------------------------------------------------------------

type PropValue = string | number | boolean | null | readonly string[];
type Props = Record<string, PropValue | undefined>;

/** Banner on every mirror note: where it comes from and what an edit does (section 3.5). */
export const MIRROR_BANNER =
  '> [!info] Mirrored from Foundry by the AI Tool\n' +
  '> The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, ' +
  'the tool stops updating it and lists it in `AI Tool/Foundry/_status.md`. Write your own ' +
  'notes in `Prep/`.';

const NAME_CHARS = EXPORT_INDEX_LIMITS.nameChars;
const WORLD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/** Block ids Obsidian accepts: letters, digits, dashes. */
const BLOCK_ID = /^[A-Za-z0-9-]{1,80}$/;
/** Foundry document ids are alphanumeric; the journal index gives each page line `^p-<id>`. */
const PAGE_ID = /^[A-Za-z0-9]{1,32}$/;
/** Characters that break a `[[path|label]]` wikilink target. */
const UNSAFE_WIKILINK_PATH = /[[\]|#^\r\n]/;
/** Embedded item types already shown as properties (class, species, background): not listed as features. */
const HIDDEN_FEATURE_TYPES: ReadonlySet<string> = new Set([
  'class',
  'subclass',
  'race',
  'background',
]);

/** `AI Tool/Bases/`: where the mirror writes its bases (the O2 exporter does not prune this folder). */
const BASES_FOLDER = 'AI Tool/Bases';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One line: control characters and every run of whitespace become a single space. */
function oneLine(text: string): string {
  return Array.from(text, ch => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : ch;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
function clip(text: string, max: number): string {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** A value for a YAML property: one line, clipped, and no `[[` or `]]` (a live link in Obsidian). */
function propText(text: string, max: number = NAME_CHARS): string {
  return clip(oneLine(text), max)
    .replace(/\[(?=\[)/g, '[ ')
    .replace(/\](?=\])/g, '] ')
    .trim();
}

/** A property string, or null when empty. */
function optText(text: string | null): string | null {
  if (text === null) return null;
  return propText(text) || null;
}

function optNumber(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A label for Markdown body text: one line, clipped, Markdown punctuation escaped, `<` as `&lt;`. */
function escapeMd(text: string, max: number = NAME_CHARS): string {
  return clip(oneLine(text), max)
    .replace(/[\\`*_[\]|~#^%$=>]/g, '\\$&')
    .replace(/</g, '&lt;');
}

/** `text` in a code span whose fence is longer than any backtick run inside. */
function codeSpan(text: string): string {
  const line = oneLine(text);
  let longest = 0;
  for (const run of line.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function isoTime(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function assertWorldId(worldId: string): void {
  if (!WORLD_ID.test(worldId)) {
    throw new Error(`Not a usable world id for the mirror: ${JSON.stringify(worldId)}`);
  }
}

function assertUuid(uuid: string): void {
  if (!isFoundryUuid(uuid)) {
    throw new Error(`Not a Foundry uuid: ${JSON.stringify(clip(uuid, 80))}`);
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function safeBlockId(blockId: string | undefined): string | undefined {
  return blockId !== undefined && BLOCK_ID.test(blockId) ? blockId : undefined;
}

/** A relative Markdown link from one campaign-relative note to another. */
function noteLink(fromPath: string, toPath: string, label: string, blockId?: string): string {
  const text = escapeMd(label) || 'Untitled';
  return `[${text}](${relativeLinkTarget(fromPath, toPath, safeBlockId(blockId))})`;
}

/**
 * A link to any top-level document or page: the mirror note (or block) when there is one, the
 * label as an Open in Foundry link when the document exists without a note, and the plain label when it
 * certainly is not in the world (the convention of design section 5).
 */
function targetLink(
  ctx: MirrorRenderContext,
  fromPath: string,
  uuid: string,
  label: string | null,
  fallbackLabel: string | null = null
): string {
  const target: LinkTarget | null = ctx.resolve(uuid);
  const kind =
    uuid.split('.')[0] === 'Scene'
      ? 'scene'
      : uuid.includes('JournalEntryPage')
        ? 'journal page'
        : 'journal';
  if (target === null) {
    // Never a raw uuid: name what is missing in words.
    return `${escapeMd(label ?? fallbackLabel ?? `A ${kind}`)} (no longer in this world)`;
  }
  const text = label ?? target.name ?? fallbackLabel ?? `A ${kind}`;
  if (target.notePath === null) {
    const base = ctx.openBase;
    if (base && !/[\s()<>]/.test(base) && isFoundryUuid(uuid)) {
      return `[${escapeMd(text)}](${openUrl(base, uuid)})`;
    }
    return escapeMd(text);
  }
  return noteLink(fromPath, target.notePath, text, target.blockId);
}

/** The first candidate the world knows, else the first candidate. */
function pickTarget(ctx: MirrorRenderContext, candidates: Array<string | null>): string | null {
  const present = candidates.filter((uuid): uuid is string => uuid !== null);
  return present.find(uuid => ctx.resolve(uuid) !== null) ?? present[0] ?? null;
}

/** The "Open in Foundry" line; a plain sentence when the dashboard address is not set. */
function openLine(ctx: MirrorRenderContext, uuid: string): string {
  const base = ctx.openBase;
  if (!base || /[\s()<>]/.test(base) || !isFoundryUuid(uuid)) {
    return 'Open in Foundry is off (set `FOUNDRY_AI_OPEN_BASE` to turn it on).';
  }
  return `[Open in Foundry](${openUrl(base, uuid)})`;
}

/**
 * A property that points at a note: a quoted wikilink (Obsidian resolves only those in
 * properties), or the plain label when the path has characters a wikilink cannot carry.
 */
function noteProp(worldId: string, notePath: string | null, label: string): string | null {
  if (notePath === null) return null;
  if (UNSAFE_WIKILINK_PATH.test(notePath)) return propText(label) || null;
  return propertyWikilink(worldId, notePath, label);
}

function linkContext(
  ctx: MirrorRenderContext,
  pageUuid: string,
  fromPath: string,
  selfName: string | null = null
): LinkContext {
  const findByName = ctx.findByName;
  const image = ctx.image
    ? (src: string, alt: string): string | null => ctx.image?.(src, alt) ?? null
    : null;
  return {
    pageUuid,
    openBase: ctx.openBase,
    resolve: uuid => ctx.resolve(uuid),
    ...(findByName ? { findByName: (kind: string, name: string) => findByName(kind, name) } : {}),
    fromPath,
    ...(ctx.library ? { library: ctx.library } : {}),
    ...(image ? { image: (src: string, alt: string) => image(src, alt) } : {}),
    selfName,
  };
}

/**
 * The one line that stands in for licensed text and images while git could pick them up
 * (design 13.4); the status note says why and how to fix it.
 */
function withheldLine(fromPath: string): string {
  return `*Book text and images are left out of this note while git could pick them up; see ${noteLink(fromPath, MIRROR_STATUS_PATH, 'the mirror status')}.*`;
}

/** An image of the document (portrait, map), embedded from its vault copy; null without one. */
function imageBlock(
  ctx: MirrorRenderContext,
  src: string | null,
  alt: string,
  width?: number
): string | null {
  if (!src || !ctx.image) return null;
  return ctx.image(src, alt, width);
}

/** A spell in a stat block: its Library note (by source, else by name) or null for the name. */
function spellLinker(
  ctx: MirrorRenderContext,
  fromPath: string
): (spell: { name: string; sourceUuid: string | null }) => string | null {
  return spell => {
    const library = ctx.library;
    if (!library) return null;
    const uuid =
      (spell.sourceUuid && library.byUuid(spell.sourceUuid) ? spell.sourceUuid : null) ??
      library.spellByName?.(spell.name) ??
      null;
    const target = uuid ? library.byUuid(uuid) : null;
    if (!target?.notePath) return null;
    return noteLink(fromPath, target.notePath, spell.name);
  };
}

// ---------------------------------------------------------------------------
// Note assembly
// ---------------------------------------------------------------------------

export function mirrorNoteType(entry: ExportEntry): MirrorNoteType {
  if (entry.kind === 'actor') return entry.pc ? 'pc' : 'npc';
  if (entry.kind === 'scene') return 'scene';
  if (entry.kind === 'journal') return 'journal';
  return 'story-item';
}

interface CommonInput {
  type: MirrorNoteType;
  /** Foundry document name (`Actor`, `Scene`, `JournalEntry`, `JournalEntryPage`, `Item`). */
  fvttType: string;
  uuid: string;
  name: string;
  /** Folder path joined with `/`, or null. */
  folder: string | null;
  own: Props;
  modified: number | null;
  /** null: no `fvtt_sig` (page notes; reconcile compares top-level documents only). */
  sig: string | null;
  playerAccess: PlayerAccess;
  playerVisible: boolean;
  rules: RulesTag | null;
}

/** The property block of a mirror note, in the order of design section 3.2. */
function mirrorProps(worldId: string, c: CommonInput): Props {
  const name = propText(c.name) || 'Untitled';
  return {
    type: c.type,
    fvtt_world: worldId,
    fvtt_uuid: c.uuid,
    fvtt_type: c.fvttType,
    name,
    folder: c.folder,
    ...c.own,
    aliases: [name],
    fvtt_modified: isoTime(c.modified),
    fvtt_sig: c.sig === null ? undefined : propText(c.sig),
    player_access: propText(c.playerAccess),
    player_visible: c.playerVisible,
    rules: c.rules === null ? null : propText(c.rules),
    schema: 1,
    tags: [`campaign/${worldId}`, c.type],
    generated_by: GENERATED_BY,
    generated_hash: '',
  };
}

function folderText(entry: ExportEntry): string | null {
  if (!entry.folder) return null;
  const path = entry.folder.path.map(segment => clip(oneLine(segment), NAME_CHARS)).join('/');
  return propText(path, NAME_CHARS * 5) || null;
}

/** H1, banner, then the body; trailing blank lines trimmed, one final newline. */
function noteText(props: Props, title: string, lines: string[]): string {
  const body = [...lines];
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return withGeneratedHash(
    [
      frontmatter(props),
      `# ${escapeMd(title) || 'Untitled'}`,
      '',
      MIRROR_BANNER,
      '',
      ...body,
      '',
    ].join('\n')
  );
}

// ---------------------------------------------------------------------------
// Shared body sections
// ---------------------------------------------------------------------------

function classesLine(entry: ExportActorEntry): string | null {
  const parts = entry.classes
    .map(c => `${propText(c.name)} ${count(c.levels)}`.trim())
    .filter(part => part !== '');
  return parts.length ? parts.join(' / ') : null;
}

function classesSection(entry: ExportActorEntry): string[] {
  if (entry.classes.length === 0) return [];
  return [
    '## Classes',
    '',
    ...entry.classes.map(c => {
      const subclass = c.subclass ? ` (${escapeMd(c.subclass)})` : '';
      return `- ${escapeMd(c.name) || 'Unnamed'} ${count(c.levels)}${subclass}`;
    }),
    '',
  ];
}

/** Embedded item names grouped by type (types and names in code-unit order, so the text is stable). */
function featureSections(features: ExportActorEntry['features']): string[] {
  const groups = new Map<string, string[]>();
  for (const feature of features) {
    const type = oneLine(feature.type).toLowerCase() || 'other';
    if (HIDDEN_FEATURE_TYPES.has(type)) continue;
    const list = groups.get(type) ?? [];
    list.push(feature.name);
    groups.set(type, list);
  }
  if (groups.size === 0) return [];
  const out = ['## Features', ''];
  for (const type of [...groups.keys()].sort(cmp)) {
    out.push(`### ${escapeMd(capitalize(type))}`, '');
    for (const name of [...(groups.get(type) ?? [])].sort(cmp)) {
      out.push(`- ${escapeMd(name) || 'Unnamed'}`);
    }
    out.push('');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function renderActor(
  worldId: string,
  entry: ExportActorEntry,
  ctx: MirrorRenderContext,
  path: string
): string {
  const type = mirrorNoteType(entry);
  const label = propText(entry.name) || 'Untitled';
  const prep = noteProp(worldId, ctx.prepNotePath(entry.uuid), `${label} prep`);
  const prepPath = ctx.prepNotePath(entry.uuid);
  let own: Props;
  const lines: string[] = [openLine(ctx, entry.uuid), ''];

  if (type === 'pc') {
    const statsPath = ctx.statsNotePath(entry.uuid);
    own = {
      player: entry.owners.map(owner => propText(owner)).filter(owner => owner !== ''),
      class: classesLine(entry),
      level: optNumber(entry.level),
      species: optText(entry.species),
      background: optText(entry.background),
      hp_max: optNumber(entry.hpMax),
      ac: optNumber(entry.ac),
      stats: noteProp(worldId, statsPath, `${label} stats`),
      prep,
    };
    const owners = entry.owners.map(owner => escapeMd(owner)).filter(owner => owner !== '');
    if (owners.length) lines.push(`Played by ${owners.join(', ')}.`, '');
    lines.push(...classesSection(entry));
    if (entry.notableItems.length) {
      lines.push('## Notable items', '');
      const items = [...entry.notableItems].sort(
        (a, b) => cmp(a.name, b.name) || cmp(a.sourceUuid ?? '', b.sourceUuid ?? '')
      );
      for (const item of items) {
        const itemPath = item.sourceUuid ? ctx.notePath(item.sourceUuid) : null;
        lines.push(
          `- ${itemPath ? noteLink(path, itemPath, item.name) : escapeMd(item.name) || 'Unnamed'}`
        );
      }
      lines.push('');
    }
    lines.push(...featureSections(entry.features));
    const related: string[] = [];
    if (statsPath) related.push(`- ${noteLink(path, statsPath, 'Stats')}`);
    if (prepPath) related.push(`- ${noteLink(path, prepPath, 'Prep')}`);
    if (related.length) lines.push('## Related notes', '', ...related, '');
  } else {
    own = {
      cr: optNumber(entry.cr),
      creature_type: optText(entry.creatureType),
      size: optText(entry.size),
      alignment: optText(entry.alignment),
      disposition: optText(entry.disposition),
      token_name: optText(entry.tokenName),
      player_name: optText(entry.playerName),
      hp_max: optNumber(entry.hpMax),
      ac: optNumber(entry.ac),
      source_book: optText(entry.sourceBook),
      prep,
    };
    lines.push(`Players see this creature as: **${escapeMd(entry.playerName) || 'Unknown'}**.`, '');
    const withhold = ctx.withholdLicensed === true;
    const block = entry.statBlock ?? null;
    if (withhold && (block !== null || Boolean(entry.img))) lines.push(withheldLine(path), '');
    const portrait = withhold ? null : imageBlock(ctx, entry.img ?? null, entry.name, 250);
    if (portrait) lines.push(portrait, '');
    lines.push(...classesSection(entry));
    if (block && !withhold) {
      const link = linkContext(ctx, entry.uuid, path, entry.name);
      lines.push(
        statBlockMarkdown(entry.name, block, link, { spellLink: spellLinker(ctx, path) }),
        ''
      );
      if (block.description) {
        const description = htmlToMarkdown(block.description, link);
        if (description) lines.push('## Description', '', description, '');
      }
    } else {
      lines.push(...featureSections(entry.features));
    }
    if (prepPath) lines.push('## Related notes', '', `- ${noteLink(path, prepPath, 'Prep')}`, '');
  }

  const props = mirrorProps(worldId, {
    type,
    fvttType: 'Actor',
    uuid: entry.uuid,
    name: entry.name,
    folder: folderText(entry),
    own,
    modified: entry.modified,
    sig: entry.sig,
    playerAccess: entry.playerAccess,
    playerVisible: entry.playerVisible,
    rules: entry.rules,
  });
  return noteText(props, entry.name, lines);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

function renderScene(
  worldId: string,
  entry: ExportSceneEntry,
  ctx: MirrorRenderContext,
  path: string
): string {
  const navName = optText(entry.navName);
  const journalUuid = entry.journal
    ? pickTarget(ctx, [entry.journal.pageUuid, entry.journal.uuid])
    : null;
  const journalNotePath = entry.journal ? ctx.notePath(entry.journal.uuid) : null;
  const journalProp = entry.journal
    ? (noteProp(worldId, journalNotePath, ctx.resolve(entry.journal.uuid)?.name ?? 'Journal') ??
      null)
    : null;

  const lines: string[] = [
    openLine(ctx, entry.uuid),
    '',
    'The active scene is always visible to players, whatever the navigation settings say.',
    '',
  ];
  if (entry.navigation && navName === null) {
    lines.push(
      '> [!warning] Players see the true name',
      `> This scene is in the navigation bar and has no navigation name, so players see "${escapeMd(entry.name)}" there.`,
      ''
    );
  }
  if (ctx.withholdLicensed === true) {
    if (entry.map) lines.push('## Map', '', withheldLine(path), '');
  } else {
    const map = imageBlock(ctx, entry.map ?? null, entry.name);
    if (map) lines.push('## Map', '', map, '');
  }
  if (journalUuid !== null) {
    lines.push('## Journal', '', `- ${targetLink(ctx, path, journalUuid, null)}`, '');
  }
  if (entry.pins.length > 0) {
    lines.push('## Map pins', '');
    for (const pin of entry.pins) {
      const target = pickTarget(ctx, [pin.pageUuid, pin.entryUuid]);
      const pinLabel = pin.label ? oneLine(pin.label) || null : null;
      if (target === null) lines.push(`- ${escapeMd(pinLabel ?? 'Unlabelled pin')}`);
      else lines.push(`- ${targetLink(ctx, path, target, pinLabel)}`);
    }
    lines.push('');
  }

  const props = mirrorProps(worldId, {
    type: 'scene',
    fvttType: 'Scene',
    uuid: entry.uuid,
    name: entry.name,
    folder: folderText(entry),
    own: {
      nav_name: navName,
      player_name: propText(entry.navName ?? '') || propText(entry.name) || 'Untitled',
      navigation: entry.navigation,
      journal: journalProp,
      pins: count(entry.pins.length),
    },
    modified: entry.modified,
    sig: entry.sig,
    playerAccess: entry.playerAccess,
    playerVisible: entry.playerVisible,
    rules: entry.rules,
  });
  return noteText(props, entry.name, lines);
}

// ---------------------------------------------------------------------------
// Journals and pages
// ---------------------------------------------------------------------------

/** Pages whose text becomes a page note: the journal is opted in, the page has text and a path. */
function textPages(
  entry: ExportJournalEntry,
  ctx: MirrorRenderContext
): Array<{ page: ExportPageEntry; path: string }> {
  if (!entry.textIncluded) return [];
  const out: Array<{ page: ExportPageEntry; path: string }> = [];
  for (const page of entry.pages) {
    if (!page.text) continue;
    const pagePath = ctx.pageNotePath(page.uuid);
    if (pagePath !== null) out.push({ page, path: pagePath });
  }
  return out;
}

function pageGroups(
  entry: ExportJournalEntry
): Array<{ heading: string | null; pages: ExportPageEntry[] }> {
  const categories = [...entry.categories].sort((a, b) => a.sort - b.sort || cmp(a.id, b.id));
  const known = new Set(categories.map(c => c.id));
  const anyCategorized = entry.pages.some(p => p.category !== null && known.has(p.category));
  if (!anyCategorized) return [{ heading: null, pages: entry.pages }];
  const groups: Array<{ heading: string | null; pages: ExportPageEntry[] }> = [];
  for (const category of categories) {
    const pages = entry.pages.filter(p => p.category === category.id);
    if (pages.length) groups.push({ heading: category.name || 'Unnamed category', pages });
  }
  const rest = entry.pages.filter(p => p.category === null || !known.has(p.category));
  if (rest.length) groups.push({ heading: 'No category', pages: rest });
  return groups;
}

function pageLine(
  page: ExportPageEntry,
  indexPath: string,
  pagePath: string | null,
  revealed: boolean
): string {
  const name = pagePath ? noteLink(indexPath, pagePath, page.name) : escapeMd(page.name);
  const parts = [
    oneLine(page.type) || 'page',
    `access ${oneLine(page.playerAccess)}`,
    page.playerVisible ? 'players can open' : null,
    revealed ? 'revealed' : null,
    page.textOmitted === 'budget' ? 'text over budget' : null,
  ].filter((part): part is string => part !== null);
  const id = PAGE_ID.test(page.id) ? ` ^p-${page.id}` : '';
  return `- ${name || 'Untitled page'} (${escapeMd(parts.join(', '))})${id}`;
}

function renderJournalIndex(
  worldId: string,
  entry: ExportJournalEntry,
  ctx: MirrorRenderContext,
  path: string,
  pageNotePaths: ReadonlyMap<string, string>
): string {
  const revealed = ctx.revealedPageUuids;
  const lines: string[] = [openLine(ctx, entry.uuid), ''];
  const total = count(entry.pagesTotal);
  if (entry.pages.length === 0) {
    lines.push('This journal has no pages.', '');
  } else {
    lines.push('## Pages', '');
    if (total > entry.pages.length) {
      lines.push(`Showing the first ${entry.pages.length} of ${total} pages.`, '');
    }
    for (const group of pageGroups(entry)) {
      if (group.heading !== null) lines.push(`### ${escapeMd(group.heading)}`, '');
      for (const page of group.pages) {
        lines.push(
          pageLine(page, path, pageNotePaths.get(page.uuid) ?? null, revealed.has(page.uuid))
        );
      }
      lines.push('');
    }
  }

  const props = mirrorProps(worldId, {
    type: 'journal',
    fvttType: 'JournalEntry',
    uuid: entry.uuid,
    name: entry.name,
    folder: folderText(entry),
    own: {
      pages: total,
      pages_player_visible: entry.pages.filter(p => p.playerVisible).length,
      pages_revealed: entry.pages.filter(p => revealed.has(p.uuid)).length,
      text_mirrored: entry.textIncluded,
      categories: [...entry.categories]
        .sort((a, b) => a.sort - b.sort || cmp(a.id, b.id))
        .map(c => propText(c.name))
        .filter(name => name !== ''),
    },
    modified: entry.modified,
    sig: entry.sig,
    playerAccess: entry.playerAccess,
    playerVisible: entry.playerVisible,
    rules: entry.rules,
  });
  return noteText(props, entry.name, lines);
}

function renderJournalPage(
  worldId: string,
  journal: ExportJournalEntry,
  page: ExportPageEntry,
  indexPath: string,
  pagePath: string,
  ctx: MirrorRenderContext
): string {
  assertUuid(page.uuid);
  const text = page.text;
  const journalLabel = propText(journal.name) || 'Untitled';
  const lines: string[] = [openLine(ctx, page.uuid), ''];
  const blockId = PAGE_ID.test(page.id) ? `p-${page.id}` : undefined;
  lines.push(`Back to journal: ${noteLink(pagePath, indexPath, journal.name, blockId)}`, '');

  if (text && ctx.withholdLicensed === true) {
    lines.push(withheldLine(pagePath));
  } else if (text) {
    if (text.truncated) {
      const kb = Math.round(EXPORT_INDEX_LIMITS.textPerPageBytes / 1024);
      lines.push(
        '> [!warning] Text cut',
        `> The page text is longer than ${kb} KB; the mirror keeps the first part.`,
        ''
      );
    }
    const link = linkContext(ctx, page.uuid, pagePath);
    const converted =
      text.format === 'html'
        ? htmlToMarkdown(text.content, link)
        : markdownPageText(text.content, link);
    lines.push(
      converted.trim() === '' ? '(This page has no text.)' : converted.replace(/\s+$/, '')
    );
  }

  const props = mirrorProps(worldId, {
    type: 'journal-page',
    fvttType: 'JournalEntryPage',
    uuid: page.uuid,
    name: page.name,
    folder: folderText(journal),
    own: {
      fvtt_journal: journal.uuid,
      journal: noteProp(worldId, indexPath, journalLabel),
      page_type: optText(page.type),
      revealed: ctx.revealedPageUuids.has(page.uuid),
      sort: optNumber(page.sort),
    },
    modified: page.modified,
    // No `fvtt_sig`: reconcile compares top-level documents, and the journal's sig
    // here would rewrite every page note whenever any one page changed.
    sig: null,
    playerAccess: page.playerAccess,
    playerVisible: page.playerVisible,
    rules: null,
  });
  return noteText(props, page.name, lines);
}

function renderJournal(
  worldId: string,
  entry: ExportJournalEntry,
  ctx: MirrorRenderContext,
  path: string
): RenderedNote[] {
  const pages = textPages(entry, ctx);
  const paths = new Map(pages.map(({ page, path: pagePath }) => [page.uuid, pagePath]));
  const notes: RenderedNote[] = [
    { path, text: renderJournalIndex(worldId, entry, ctx, path, paths) },
  ];
  for (const { page, path: pagePath } of pages) {
    notes.push({
      path: pagePath,
      text: renderJournalPage(worldId, entry, page, path, pagePath, ctx),
    });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Story items
// ---------------------------------------------------------------------------

function renderItem(
  worldId: string,
  entry: ExportItemEntry,
  ctx: MirrorRenderContext,
  path: string
): string {
  const holderProp = (holder: ExportItemEntry['holders'][number]): string =>
    noteProp(worldId, ctx.notePath(holder.uuid), holder.name) ?? propText(holder.name);
  const lines: string[] = [openLine(ctx, entry.uuid), '', '## Held by', ''];
  if (entry.holders.length === 0) {
    lines.push('- (none)');
  } else {
    for (const holder of entry.holders) {
      const holderPath = ctx.notePath(holder.uuid);
      const name = holderPath ? noteLink(path, holderPath, holder.name) : escapeMd(holder.name);
      const how = holder.match === 'source' ? 'same source item' : 'same name';
      lines.push(`- ${name || 'Unnamed'} (${how})`);
    }
  }
  lines.push('');

  const props = mirrorProps(worldId, {
    type: 'story-item',
    fvttType: 'Item',
    uuid: entry.uuid,
    name: entry.name,
    folder: folderText(entry),
    own: {
      item_type: optText(entry.itemType),
      rarity: optText(entry.rarity),
      attunement: optText(entry.attunement),
      magical: entry.magical,
      identified: entry.identified,
      player_name: optText(entry.playerName),
      holders: entry.holders.map(holderProp).filter(text => text !== ''),
    },
    modified: entry.modified,
    sig: entry.sig,
    playerAccess: entry.playerAccess,
    playerVisible: entry.playerVisible,
    rules: entry.rules,
  });
  return noteText(props, entry.name, lines);
}

// ---------------------------------------------------------------------------
// Public: notes
// ---------------------------------------------------------------------------

/**
 * The note (and, for an opted-in journal, its page notes) for one export entry. Empty when the
 * context allocated no path for it. Throws on a bad world id or uuid, and when the converter
 * throws on page text (the pump reports it per note).
 */
export function renderMirrorNote(
  worldId: string,
  entry: ExportEntry,
  ctx: MirrorRenderContext
): RenderedNote[] {
  assertWorldId(worldId);
  assertUuid(entry.uuid);
  const path = ctx.notePath(entry.uuid);
  if (path === null) return [];
  if (entry.kind === 'actor') return [{ path, text: renderActor(worldId, entry, ctx, path) }];
  if (entry.kind === 'scene') return [{ path, text: renderScene(worldId, entry, ctx, path) }];
  if (entry.kind === 'journal') return renderJournal(worldId, entry, ctx, path);
  return [{ path, text: renderItem(worldId, entry, ctx, path) }];
}

/** Property lines the "no rewrite for a timestamp alone" rule ignores (section 3.5). */
const VOLATILE_PROPERTIES: readonly string[] = ['fvtt_modified:', 'generated_hash:'];

function withoutVolatileProperties(text: string): string {
  const lines = text.split('\n');
  if (lines[0] !== '---') return text;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line === '---') break;
    const key = VOLATILE_PROPERTIES.find(prefix => line.startsWith(prefix));
    if (key) lines[i] = key;
  }
  return lines.join('\n');
}

/**
 * Whether two renders of a note differ only in `fvtt_modified` (and the hash that follows from
 * it). The pump skips the write then, so HP churn never rewrites a note the GM has open. Call it
 * only for an existing note that already passed the ownership check.
 */
export function sameMirrorContent(existingText: string, nextText: string): boolean {
  return withoutVolatileProperties(existingText) === withoutVolatileProperties(nextText);
}

// ---------------------------------------------------------------------------
// Public: bases
// ---------------------------------------------------------------------------

export interface MirrorBaseFile {
  /** File name without the folder, e.g. `Story items.base`. */
  file: string;
  /** Campaign-relative path. */
  path: string;
}

/** The six bases the mirror writes, in the order the Campaign Home lists them. */
export const MIRROR_BASE_FILES: readonly MirrorBaseFile[] = [
  'PCs.base',
  'NPCs.base',
  'Scenes.base',
  'Journals.base',
  'Story items.base',
  'Player visible.base',
].map(file => ({ file, path: `${BASES_FOLDER}/${file}` }));

interface BaseSpec {
  file: string;
  view: string;
  /** Tag filter, or null for a property filter. */
  tag: string | null;
  /** Extra filter lines. */
  filters?: string[];
  columns: string[];
}

const BASE_SPECS: readonly BaseSpec[] = [
  {
    file: 'PCs.base',
    view: 'PCs',
    tag: 'pc',
    columns: [
      'file.name',
      'player',
      'class',
      'level',
      'species',
      'background',
      'hp_max',
      'ac',
      'player_access',
    ],
  },
  {
    file: 'NPCs.base',
    view: 'NPCs',
    tag: 'npc',
    columns: [
      'file.name',
      'cr',
      'creature_type',
      'disposition',
      'player_name',
      'player_visible',
      'folder',
    ],
  },
  {
    file: 'Scenes.base',
    view: 'Scenes',
    tag: 'scene',
    columns: ['file.name', 'nav_name', 'player_name', 'navigation', 'player_visible', 'folder'],
  },
  {
    file: 'Journals.base',
    view: 'Journals',
    tag: 'journal',
    columns: [
      'file.name',
      'pages',
      'pages_player_visible',
      'pages_revealed',
      'text_mirrored',
      'folder',
    ],
  },
  {
    file: 'Story items.base',
    view: 'Story items',
    tag: 'story-item',
    columns: [
      'file.name',
      'item_type',
      'rarity',
      'magical',
      'identified',
      'holders',
      'player_visible',
    ],
  },
  {
    file: 'Player visible.base',
    view: 'Player visible',
    tag: null,
    filters: ['player_visible == true'],
    columns: ['file.name', 'type', 'player_access', 'folder'],
  },
];

/**
 * `AI Tool/Bases/{PCs,NPCs,Scenes,Journals,Story items,Player visible}.base`: tables over the
 * mirror notes (compared by content, like the O2 bases). Filters use the known-good forms
 * `file.inFolder(..)` and `file.hasTag(..)`; `Player visible` adds `player_visible == true`.
 */
export function renderMirrorBases(worldId: string): RenderedNote[] {
  assertWorldId(worldId);
  return BASE_SPECS.map(spec => {
    const lines = [
      'filters:',
      '  and:',
      `    - file.inFolder("Campaigns/${worldId}/${MIRROR_ROOT}")`,
      ...(spec.tag === null ? [] : [`    - file.hasTag("${spec.tag}")`]),
      ...(spec.filters ?? []).map(filter => `    - ${filter}`),
      'views:',
      '  - type: table',
      `    name: ${spec.view}`,
      '    order:',
      ...spec.columns.map(column => `      - ${column}`),
      '    sort:',
      '      - property: file.name',
      '        direction: ASC',
    ];
    return {
      path: `${BASES_FOLDER}/${spec.file}`,
      text: renderBaseText(`${lines.join('\n')}\n`),
    };
  });
}

// ---------------------------------------------------------------------------
// Public: status note
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<MirrorNoteType, string> = {
  pc: 'PCs',
  npc: 'NPCs',
  scene: 'Scenes',
  journal: 'Journals',
  'journal-page': 'Journal pages (text)',
  'story-item': 'Story items',
};

function byPath<T extends { path: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => cmp(a.path, b.path));
}

function listOrNone(lines: string[]): string[] {
  return lines.length ? lines : ['- (none)'];
}

/** The Library and image sections of the status note (only lasting facts). */
function licensedStatusLines(status: MirrorStatus): string[] {
  const out: string[] = [];
  const text = status.licensedText;
  if (text && !text.allowed) {
    const folder = codeSpan(`Campaigns/${status.worldId ?? '<world>'}/AI Tool/`);
    out.push(
      '## Book text in world notes',
      '',
      '> [!warning] Stat blocks, page text and images are left out of world notes',
      `> ${escapeMd(text.reason ?? 'git could pick them up', 600)}`,
      '>',
      '> Licensed text (book and compendium text, imported images) may only be written where git will not pick it up. To fix it, do one of these:',
      `> - add the mirror folder ${folder} and the vault trash folder ${codeSpan('.trash/')} to the repository's ${codeSpan('.gitignore')} (and untrack anything git already tracks there), or`,
      '> - move the vault out of the git repository.',
      '>',
      '> The mirror checks again every few minutes and then rewrites the notes with the full text.',
      ''
    );
  }
  const library = status.library;
  if (library) {
    out.push('## Library (compendium notes)', '');
    if (library.blocked) {
      out.push(`> [!warning] The Library is off`, `> ${escapeMd(library.blocked, 600)}`, '');
    }
    if (library.packs.length === 0) {
      out.push('No compendium packs are picked (`libraryPacks` in `plan-obsidian-mirror`).', '');
    } else {
      out.push(
        `Packs: ${library.packs.map(pack => codeSpan(pack)).join(', ')}. The notes live in ${codeSpan('AI Tool/Library/')}, which is kept out of git (licensed content).`,
        ''
      );
      if (library.missingPacks.length) {
        out.push(
          `Not in this world: ${library.missingPacks.map(pack => codeSpan(pack)).join(', ')}.`,
          ''
        );
      }
      const kinds = Object.keys(library.counts).sort(cmp);
      out.push('| Kind | Notes |', '| --- | --- |');
      for (const kind of kinds)
        out.push(`| ${escapeMd(kind)} | ${count(library.counts[kind] ?? 0)} |`);
      if (kinds.length === 0) out.push('| (none yet) | 0 |');
      out.push('');
    }
    const problems = [
      ...byPath(library.skipped).map(s => `- ${codeSpan(s.path)}: ${escapeMd(s.reason, 400)}`),
      ...byPath(library.errors).map(e => `- ${codeSpan(e.path)}: ${escapeMd(e.error, 400)}`),
    ];
    if (problems.length) out.push('Skipped or failed:', '', ...problems, '');
  }
  const images = status.images;
  if (images) {
    out.push('## Images', '');
    if (images.blocked) out.push(`No images are copied: ${escapeMd(images.blocked, 600)}`, '');
    else {
      out.push(
        `${count(images.copied)} image(s) copied into ${codeSpan('AI Tool/Attachments/')} (kept out of git).`,
        ''
      );
    }
    if (images.note) out.push(escapeMd(images.note, 600), '');
    if (images.failed.length) {
      out.push(
        'Could not copy (retried later):',
        '',
        ...byPath(images.failed).map(f => `- ${codeSpan(f.path)}: ${escapeMd(f.error, 300)}`),
        ''
      );
    }
  }
  return out;
}

/**
 * `AI Tool/Foundry/_status.md`: how many notes the mirror keeps, and what it left alone or could
 * not do. Only lasting facts (no times, no per-cycle counts of work), so it is not rewritten on
 * every cycle.
 */
export function renderMirrorStatusNote(worldId: string, status: MirrorStatus): RenderedNote {
  assertWorldId(worldId);
  const managed = MIRROR_NOTE_TYPES.reduce((sum, type) => sum + count(status.counts[type]), 0);
  const skipped = byPath(status.skipped);
  const moved = byPath(status.movedByGm);
  const duplicates = byPath(status.duplicates);
  const kept = byPath(status.keptDeleted);
  const errors = byPath(status.errors);
  const truncated = [...status.truncated].sort((a, b) => cmp(a.kind, b.kind));

  const own: Props = { notes_managed: managed };
  for (const type of MIRROR_NOTE_TYPES) {
    own[`notes_${type.replace(/-/g, '_')}`] = count(status.counts[type]);
  }
  own['notes_skipped'] = skipped.length;
  own['notes_errored'] = errors.length;
  const props = generatedProps('mirror-status', worldId, own, null);

  const openBase = status.openBase && !/[\s()<>]/.test(status.openBase) ? status.openBase : null;
  const text = withGeneratedHash(
    [
      frontmatter(props),
      '# Foundry mirror status',
      '',
      MIRROR_BANNER,
      '',
      `The mirror is ${status.enabled ? 'on' : 'off'} and keeps ${managed} note(s) under ${codeSpan(`${MIRROR_ROOT}/`)}. Notes it no longer produces go to the vault trash; a note you delete comes back at the next check.`,
      '',
      `Open in Foundry links: ${openBase ? codeSpan(openBase) : 'off (set `FOUNDRY_AI_OPEN_BASE`)'}.`,
      '',
      '## Notes',
      '',
      '| Type | Notes |',
      '| --- | --- |',
      ...MIRROR_NOTE_TYPES.map(type => `| ${TYPE_LABELS[type]} | ${count(status.counts[type])} |`),
      '',
      ...licensedStatusLines(status),
      '## Skipped (edited in Obsidian, or foreign)',
      '',
      ...listOrNone(skipped.map(s => `- ${codeSpan(s.path)}: ${escapeMd(s.reason, 400)}`)),
      '',
      '## Moved outside the mirror folder (never written again)',
      '',
      ...listOrNone(moved.map(m => `- ${codeSpan(m.path)} (${codeSpan(m.uuid)})`)),
      '',
      '## Duplicates (a document with more than one note)',
      '',
      ...listOrNone(duplicates.map(d => `- ${codeSpan(d.path)} (${codeSpan(d.uuid)})`)),
      '',
      '## Deleted in Foundry, kept because you edited the note',
      '',
      ...listOrNone(kept.map(k => `- ${codeSpan(k.path)} (${codeSpan(k.uuid)})`)),
      '',
      '## Not fully mirrored (world caps)',
      '',
      ...listOrNone(
        truncated.map(
          t =>
            `- ${escapeMd(t.kind)}: the world has ${count(t.total)}, the mirror takes the first ${count(t.cap)}.`
        )
      ),
      '',
      '## Errors',
      '',
      ...listOrNone(errors.map(e => `- ${codeSpan(e.path)}: ${escapeMd(e.error, 400)}`)),
      '',
    ].join('\n')
  );
  return { path: MIRROR_STATUS_PATH, text };
}
