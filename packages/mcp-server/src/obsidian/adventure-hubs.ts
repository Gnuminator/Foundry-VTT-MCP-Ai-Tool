/**
 * Adventure hub notes (I-105): one note per adventure, so each adventure is its own cluster in
 * Obsidian's graph with one note to start from.
 *
 * An adventure is a top-level Foundry folder (the first folder below a kind folder such as
 * `AI Tool/Foundry/Journals/`). Foundry keeps folders per document type, so an imported
 * adventure has a folder of the same name under journals, scenes and actors; the hub joins them
 * by that name. A folder counts as an adventure when it holds at least one journal note and one
 * scene note. The hubs come from the mirror's own note map: no extra Foundry query.
 */
import { MIRROR_FOLDERS, pathKey } from './mirror-common.js';

/** The `type` property of an adventure hub note. */
export const ADVENTURE_HUB_TYPE = 'adventure-hub';

/** Where the hubs go: `AI Tool/Foundry/Adventures/<folder>.md`. */
export const ADVENTURES_FOLDER = MIRROR_FOLDERS.adventure;

/** The kind folders a hub collects from, in the order its sections appear. */
export const HUB_SECTIONS = [
  { type: 'journal', folder: MIRROR_FOLDERS.journal, heading: 'Chapters and journals' },
  { type: 'scene', folder: MIRROR_FOLDERS.scene, heading: 'Scenes' },
  { type: 'npc', folder: MIRROR_FOLDERS.npc, heading: 'NPCs' },
  { type: 'pc', folder: MIRROR_FOLDERS.pc, heading: 'PCs' },
  { type: 'story-item', folder: MIRROR_FOLDERS.item, heading: 'Story items' },
] as const;

/** At most this many links per section; the rest is a count. */
export const HUB_SECTION_LIMIT = 400;

export type HubSectionType = (typeof HUB_SECTIONS)[number]['type'];

/** A top-level mirror note as the hub sees it. */
export interface HubSourceNote {
  path: string;
  /** The note's `type` property; only the hub's kinds count. */
  type: string;
  /** The note's name, or null (then its file name). */
  name: string | null;
  insideFence: boolean;
}

export interface HubMember {
  path: string;
  name: string;
  /** Folders between the adventure folder and the note (`Chapter 4/Maps`), or ''. */
  subfolder: string;
}

export interface AdventureHub {
  /** The adventure's folder segment as the notes have it (`Curse of Strahd`). */
  name: string;
  /** Campaign-relative path of the hub note. */
  path: string;
  /** Campaign-relative folders that hold the adventure's notes, one per kind that has any. */
  folders: string[];
  members: Record<HubSectionType, HubMember[]>;
}

const NUMERIC = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function byFolderThenName(a: HubMember, b: HubMember): number {
  return (
    NUMERIC.compare(a.subfolder, b.subfolder) ||
    NUMERIC.compare(a.name, b.name) ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
}

function emptyMembers(): Record<HubSectionType, HubMember[]> {
  return { journal: [], scene: [], npc: [], pc: [], 'story-item': [] };
}

/**
 * The adventures among the notes: grouped by the first folder below each kind folder
 * (case-insensitive), kept when they have a journal note and a scene note. Notes outside the
 * fence (moved by the GM) and notes directly in a kind folder are left out. Sorted by name.
 */
export function collectAdventureHubs(notes: Iterable<HubSourceNote>): AdventureHub[] {
  const groups = new Map<string, AdventureHub>();
  for (const note of notes) {
    if (!note.insideFence) continue;
    const section = HUB_SECTIONS.find(s => s.type === note.type);
    if (!section) continue;
    const prefix = `${section.folder}/`;
    if (!pathKey(note.path).startsWith(pathKey(prefix))) continue;
    const rest = note.path.slice(prefix.length).split('/');
    // rest = [adventure, ...subfolders, file]: a note directly in the kind folder has no adventure.
    if (rest.length < 2) continue;
    const name = rest[0] ?? '';
    if (!name) continue;
    const key = pathKey(name);
    let hub = groups.get(key);
    if (!hub) {
      hub = {
        name,
        path: `${ADVENTURES_FOLDER}/${name}.md`,
        folders: [],
        members: emptyMembers(),
      };
      groups.set(key, hub);
    }
    const folder = `${section.folder}/${name}`;
    if (!hub.folders.some(f => pathKey(f) === pathKey(folder))) hub.folders.push(folder);
    hub.members[section.type].push({
      path: note.path,
      name: note.name ?? (rest[rest.length - 1] ?? '').replace(/\.md$/i, ''),
      subfolder: rest.slice(1, -1).join('/'),
    });
  }
  const hubs = [...groups.values()].filter(
    hub => hub.members.journal.length > 0 && hub.members.scene.length > 0
  );
  for (const hub of hubs) {
    for (const list of Object.values(hub.members)) list.sort(byFolderThenName);
    const order = HUB_SECTIONS.map(s => pathKey(s.folder));
    hub.folders.sort(
      (a, b) =>
        order.findIndex(o => pathKey(a).startsWith(`${o}/`)) -
        order.findIndex(o => pathKey(b).startsWith(`${o}/`))
    );
  }
  return hubs.sort((a, b) => NUMERIC.compare(a.name, b.name) || (a.path < b.path ? -1 : 1));
}

/**
 * The Library hub of the book an adventure comes from: the book whose title matches the
 * adventure's folder name (case and punctuation aside), or null.
 */
export function matchBookNote(
  adventure: string,
  books: ReadonlyMap<string, string>
): { title: string; path: string } | null {
  const want = bookKey(adventure);
  if (!want) return null;
  for (const [title, path] of books) {
    if (bookKey(title) === want) return { title, path };
  }
  return null;
}

function bookKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
