/**
 * Shared types and tiny helpers for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md,
 * Obsidian O4). Fixed by the lead before the build chunks start so that the
 * converter (C3), the renderer (C4), the pump (C5) and the settings/tools (C6)
 * code against one set of shapes.
 *
 * Paths: every path here is campaign-relative and POSIX-style
 * (`AI Tool/Foundry/NPCs/Wolf.md`), relative to `<vault>/Campaigns/<worldId>/`,
 * the root `NoteWriter` writes under. Vault paths (for property wikilinks) are
 * `Campaigns/<worldId>/<campaign-relative path>`.
 */
import type { ExportIndexResponse } from '@gnuminator/shared';

// ---------------------------------------------------------------------------
// Settings (bridge vault `gm/obsidian-mirror.json`, key `settings`; section 1.8)
// ---------------------------------------------------------------------------

export type MirrorKind = 'pc' | 'npc' | 'scene' | 'journal' | 'item';
export const MIRROR_KINDS: readonly MirrorKind[] = ['pc', 'npc', 'scene', 'journal', 'item'];

export interface MirrorSettings {
  schema: 1;
  /** Default false: the mirror writes nothing until the GM enables it. */
  enabled: boolean;
  /** Default all five. */
  kinds: MirrorKind[];
  /** Journals whose page text is mirrored (default none, decision 4). */
  text: { folderIds: string[]; journalIds: string[] };
  /** Never mirrored, any kind (subfolders included). */
  excludeFolderIds: string[];
  /** Default `DEFAULT_STORY_ITEM_TYPES`. */
  storyItemTypes: string[];
  /** Compendium packs (`world.my-pack`, `dnd5e.spells`) whose content gets Library notes (default none). */
  libraryPacks: string[];
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** `type` property of mirror notes. */
export type MirrorNoteType = 'pc' | 'npc' | 'scene' | 'journal' | 'journal-page' | 'story-item';
export const MIRROR_NOTE_TYPES: readonly MirrorNoteType[] = [
  'pc',
  'npc',
  'scene',
  'journal',
  'journal-page',
  'story-item',
];

/** The mirror's fence inside the campaign folder. */
export const MIRROR_ROOT = 'AI Tool/Foundry';
/** Kind folder per note family (section 3.1); a note goes below it in its Foundry folder path (I-100). */
export const MIRROR_FOLDERS = {
  pc: `${MIRROR_ROOT}/PCs`,
  npc: `${MIRROR_ROOT}/NPCs`,
  scene: `${MIRROR_ROOT}/Scenes`,
  journal: `${MIRROR_ROOT}/Journals`,
  item: `${MIRROR_ROOT}/Items`,
  /** Adventure hub notes (I-105), one per adventure folder; not a Foundry document kind. */
  adventure: `${MIRROR_ROOT}/Adventures`,
} as const;
export const MIRROR_STATUS_PATH = `${MIRROR_ROOT}/_status.md`;

/**
 * The renderer's version, appended to every signature the mirror and the Library store in
 * `fvtt_sig` (`<sig>.r3`). Bumping it makes every note count as changed once, also across a
 * restart, so a renderer change reaches every note. 2: stat blocks, images, readable enrichers;
 * 3: a feature name the text already opens with is not repeated; 4: notes by Foundry folder and
 * the Library by book (I-100), so every note is fetched once and moves to its folder; 5: every
 * Library note links its book's hub note (I-100); 6: an NPC note links what it was made from,
 * and a scene without a journal links the journal named like its folder (graph orphans);
 * 7: scene and journal notes link their prep note (I-121); 8: scene notes list who is here
 * (the NPC and PC notes of their tokens).
 */
export const MIRROR_RENDER_VERSION = 8;

/**
 * A module signature as the notes store it: with the renderer version and, optionally, a short
 * hash of the other inputs that shape the note (the licensed-content guard, the Library packs
 * and membership), so a change of those re-renders the notes once, also across a restart.
 */
export function versionedSig(sig: string, inputs = ''): string {
  return `${sig}.r${MIRROR_RENDER_VERSION}${inputs ? `.${inputs}` : ''}`;
}

/** A note the scan found (section 2.1): anything with `generated_by`, a mirror `type` and `fvtt_uuid`, plus prep and stats notes that carry `fvtt_uuid`. */
export interface ScannedNote {
  /** Campaign-relative path. */
  path: string;
  uuid: string;
  type: string;
  /** `fvtt_sig` property, or null. */
  sig: string | null;
  /** Under `MIRROR_ROOT`. */
  insideFence: boolean;
  /** `generated_by: "foundry-ai-tool"` present and its hash matches (unedited). */
  owned: boolean;
  /** `name` property, or null. */
  name: string | null;
  /** `fvtt_journal` property (page notes: their journal's uuid), or null. */
  journalUuid: string | null;
  /** `folder` property (Foundry folder names joined with `/`), or null; absent in older maps. */
  folder?: string | null;
}

/** Key for case-insensitive, Unicode-normalized path comparison (Windows and Obsidian). */
export function pathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * Foundry's base URL in the form the module reports and `FOUNDRY_AI_FOUNDRY_URL` takes: http(s),
 * an optional route prefix (`https://host/foundry`), no credentials, query, fragment or trailing
 * slash. Returns the normalized form, or null when the value is not one.
 */
export function parseBaseUrl(value: string): string | null {
  const text = value.trim();
  if (text === '' || /[?#\s]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null;
  }
  const prefix = url.pathname.replace(/\/+$/, '');
  if (prefix.includes('//')) return null;
  return `${url.origin}${prefix}`;
}

/** One link target as the pump resolves it (section 5). */
export interface LinkTarget {
  /** Campaign-relative path of the mirror note, or null when the document exists but has no mirror note. */
  notePath: string | null;
  /** The target's current name, when known. */
  name: string | null;
  /** Block id inside the note, without `^` (a page listed in a journal index note: `p-<pageId>`). */
  blockId?: string;
}

/** Library notes for compendium links (section 13); built by the pump from the Library index. */
export interface LibraryLinks {
  /** `Compendium.<pkg>.<pack>.<Type>.<id>` to its Library note (path null: in the index, no note) and name; null when unknown. */
  byUuid(uuid: string): { notePath: string | null; name: string | null } | null;
  /** Legacy `@Compendium[<pkg>.<pack>.<id or name>]`: the full uuid, or null. */
  legacy(pack: string, idOrName: string): string | null;
  /** A Library spell by exact name (stat block spells without a source), or null. */
  spellByName?(name: string): string | null;
}

/** What the HTML/Markdown converter needs to rewrite links (C3; section 9 signatures). */
export interface LinkContext {
  /** The page being converted: base for relative uuids (`@UUID[.P]`). */
  pageUuid: string;
  /** Validated `FOUNDRY_AI_OPEN_BASE` origin, no trailing slash. */
  openBase: string;
  /**
   * Absolute world uuid (top level, or `JournalEntry.J.JournalEntryPage.P`) to
   * its note. null = certainly not in the world ("(not found)").
   */
  resolve(uuid: string): LinkTarget | null;
  /** Legacy `@Actor[name]` links: an exact name to a uuid, or null. */
  findByName?(documentName: string, name: string): string | null;
  /** Campaign-relative path of the note being written. */
  fromPath: string;
  /** Compendium links to Library notes (absent: compendium links open in Foundry). */
  library?: LibraryLinks;
  /** An image path from Foundry (`<img src>`) to the Markdown that embeds it, or null (then `[image: alt]`). */
  image?(src: string, alt: string): string | null;
  /** The document the text describes (`[[lookup @name]]`). */
  selfName?: string | null;
}

/** Everything `renderMirrorNote` needs besides the entry (C4; built by the pump, C5). */
export interface MirrorRenderContext {
  openBase: string;
  /** Allocated note path for a top-level uuid (existing or new), or null when it has no mirror note. */
  notePath(uuid: string): string | null;
  /** Allocated page-note path for a text-mirrored page, else null. */
  pageNotePath(pageUuid: string): string | null;
  resolve: LinkContext['resolve'];
  findByName?: LinkContext['findByName'];
  /** M2 allowlist (`gm/reveals.json` pages): the only bridge-vault input (section 7.3). */
  revealedPageUuids: ReadonlySet<string>;
  /** O3 PC stats note (`type: pc-stats`, same `fvtt_uuid`), campaign-relative. */
  statsNotePath(actorUuid: string): string | null;
  /** The GM's prep note (`npc-prep` etc., same `fvtt_uuid`), campaign-relative. */
  prepNotePath(uuid: string): string | null;
  /** Compendium links to Library notes. */
  library?: LibraryLinks;
  /** A Foundry image path to the Markdown embed of its copy in the vault (optionally `width` px wide), or null (no copy). */
  image?(src: string, alt: string, width?: number): string | null;
  /**
   * Licensed text and images stay out of world notes (git could pick them up, design 13.4): stat
   * block bodies, opted-in page text, portraits and maps become one line pointing at the status.
   */
  withholdLicensed?: boolean;
}

export interface RenderedNote {
  /** Campaign-relative path. */
  path: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Status (section 2.4)
// ---------------------------------------------------------------------------

export interface MirrorStatus {
  enabled: boolean;
  vaultDirSet: boolean;
  worldId: string | null;
  openBase: string;
  lastCycleAt: string | null;
  lastReconcileAt: string | null;
  lastError: string | null;
  /** Mirror notes managed, per note type. */
  counts: Record<MirrorNoteType, number>;
  /** Edited in Obsidian or foreign: never overwritten. */
  skipped: Array<{ path: string; reason: string }>;
  /** Mirror notes the GM moved outside `MIRROR_ROOT`: never written again. */
  movedByGm: Array<{ path: string; uuid: string }>;
  /** Extra notes with a uuid that already has a note. */
  duplicates: Array<{ path: string; uuid: string }>;
  /** Deleted in Foundry, kept because the GM edited the note. */
  keptDeleted: Array<{ path: string; uuid: string }>;
  truncated: ExportIndexResponse['truncated'];
  errors: Array<{ path: string; error: string }>;
  /** The Library (compendium notes), or null when the mirror has not looked at it yet. */
  library: MirrorLibraryStatus | null;
  /** Image copies (attachments), or null before the first cycle. */
  images: MirrorImagesStatus | null;
  /** Whether world notes carry licensed text (stat blocks, page text, images), or null before the first cycle. */
  licensedText: { allowed: boolean; reason: string | null } | null;
}

export interface MirrorLibraryStatus {
  packs: string[];
  missingPacks: string[];
  counts: Record<string, number>;
  pending: number;
  lastRefreshAt: string | null;
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
  /** Why the Library writes nothing (the git guard), or null. */
  blocked: string | null;
}

export interface MirrorImagesStatus {
  copied: number;
  pending: number;
  failed: Array<{ path: string; error: string }>;
  blocked: string | null;
  /** A note from the git guard (git not installed), or null. */
  note: string | null;
}

export function emptyMirrorStatus(
  init: Pick<MirrorStatus, 'enabled' | 'vaultDirSet' | 'worldId' | 'openBase'>
): MirrorStatus {
  return {
    ...init,
    lastCycleAt: null,
    lastReconcileAt: null,
    lastError: null,
    counts: { pc: 0, npc: 0, scene: 0, journal: 0, 'journal-page': 0, 'story-item': 0 },
    skipped: [],
    movedByGm: [],
    duplicates: [],
    keptDeleted: [],
    truncated: [],
    errors: [],
    library: null,
    images: null,
    licensedText: null,
  };
}

// ---------------------------------------------------------------------------
// Link helpers (bodies use relative Markdown links, properties quoted wikilinks)
// ---------------------------------------------------------------------------

/** A path segment for a Markdown link target: `encodeURIComponent` plus `(` and `)`. */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** `<openBase>/open?uuid=<uuid>`: the only parameter is the uuid (section 6.1). */
export function openUrl(openBase: string, uuid: string): string {
  return `${openBase}/open?uuid=${encodeURIComponent(uuid)}`;
}

/** Relative Markdown link target from one campaign-relative note to another, encoded, with an optional `#^block`. */
export function relativeLinkTarget(fromPath: string, toPath: string, blockId?: string): string {
  const from = fromPath.split('/').slice(0, -1);
  const to = toPath.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = from.slice(common).map(() => '..');
  const target = [...up, ...to.slice(common).map(encodeSegment)].join('/');
  return blockId ? `${target}#^${blockId}` : target;
}

/** Text safe as a wikilink alias: no `[`, `]`, `|`, `#`, `^`, newlines; collapsed whitespace; 200 characters. */
export function wikilinkLabel(label: string): string {
  return label
    .replace(/[[\]|#^\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** `[[Campaigns/<worldId>/<path without .md>|<label>]]` for a property (Obsidian resolves only quoted wikilinks there). */
export function propertyWikilink(worldId: string, notePath: string, label: string): string {
  const target = `Campaigns/${worldId}/${notePath.replace(/\.md$/, '')}`;
  const alias = wikilinkLabel(label);
  return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
}
