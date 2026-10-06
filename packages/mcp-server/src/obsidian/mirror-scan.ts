/**
 * The vault scan of the Foundry mirror (docs/design/OBSIDIAN-O4-DESIGN.md 2.1).
 *
 * Walks `<vault>/Campaigns/<worldId>/` and finds the notes that matter to the
 * mirror by their properties, never by path: the GM may rename or move a note
 * (the note map is keyed by `fvtt_uuid`). What it keeps:
 *
 * - mirror notes: `generated_by: "foundry-ai-tool"`, a type in
 *   `MIRROR_NOTE_TYPES` and a non-empty `fvtt_uuid` (`mirror`, and `pages` for
 *   `journal-page` notes); their full text is read to tell an unedited note
 *   from one the GM edited (`checkMarkdownOwnership`);
 * - the GM's prep notes (`type` ending in `-prep`, or `session-plan`, with an
 *   `fvtt_uuid`) and the O3 `pc-stats` notes, as paths for links;
 * - every file under `MIRROR_ROOT`, foreign files included, as normalized
 *   keys (`takenPaths`) so the pump never picks a name that is already there.
 *
 * Read-only. Never follows a symlink or junction (`lstat`), skips dot folders
 * and `.trash`, and is capped in depth and file count. Deterministic:
 * directory entries and results are ordered by path (UTF-16 code units).
 *
 * Only the head of each note is read (4 KB); a frontmatter block that is not
 * closed inside the head is followed up to 64 KB, because a mirror note with
 * many `holders` or `features` can push `generated_by` (near the end of the
 * properties) past 4 KB.
 */
import { promises as fsp, type Stats } from 'fs';

import { ATTACHMENTS_ROOT, LIBRARY_ROOT } from './licensed-guard.js';
import { MIRROR_NOTE_TYPES, MIRROR_ROOT, pathKey, type ScannedNote } from './mirror-common.js';
import { campaignDir, errorCode, errorMessage } from './note-writer.js';
import { checkMarkdownOwnership, GENERATED_BY } from './ownership.js';

export const SCAN_MAX_DEPTH = 12;
export const SCAN_MAX_FILES = 20_000;
export const SCAN_HEAD_BYTES = 4096;
export const SCAN_FRONTMATTER_MAX_BYTES = 65_536;

const READ_CONCURRENCY = 16;
const FENCE_PREFIX = `${MIRROR_ROOT}/`;

export interface MirrorScan {
  /** Top-level uuid to the winning mirror note (may lie outside the fence: moved by the GM). */
  mirror: Map<string, ScannedNote>;
  /** Page uuid to its `journal-page` note (same winner rules). */
  pages: Map<string, ScannedNote>;
  /** Uuid to the GM's prep note path (types ending in `-prep`, and `session-plan`), first by path order. */
  prep: Map<string, string>;
  /** Actor uuid to its O3 `pc-stats` note path, first by path order. */
  stats: Map<string, string>;
  /** Winning mirror notes (top level and pages) outside `MIRROR_ROOT`: never written again. */
  movedByGm: ScannedNote[];
  /** Losers: a uuid that already has a winning note, in path order (inside or outside the fence). */
  duplicates: ScannedNote[];
  /** `pathKey()` of every file under `MIRROR_ROOT` (any extension, foreign files and links too). */
  takenPaths: Set<string>;
  /** Files visited (all extensions, not counting skipped folders). */
  fileCount: number;
  /** Which caps stopped the walk short: the result is then incomplete. */
  limitsHit: Array<'files' | 'depth'>;
  /** Folders or notes that could not be read (campaign-relative). A pump should not trust a scan with errors. */
  errors: Array<{ path: string; error: string }>;
}

export interface ScanOptions {
  /** Default {@link SCAN_MAX_DEPTH}. */
  maxDepth?: number;
  /** Default {@link SCAN_MAX_FILES}. */
  maxFiles?: number;
}

// ---------------------------------------------------------------------------
// Frontmatter: only the few keys the scan needs
// ---------------------------------------------------------------------------

interface HeadValues {
  type: string | null;
  fvtt_uuid: string | null;
  fvtt_sig: string | null;
  fvtt_journal: string | null;
  name: string | null;
  folder: string | null;
  generated_by: string | null;
}

const KEYS: ReadonlySet<string> = new Set([
  'type',
  'fvtt_uuid',
  'fvtt_sig',
  'fvtt_journal',
  'name',
  'folder',
  'generated_by',
]);

/** A YAML double-quoted scalar (ours are JSON-quoted); trailing comment ignored. */
function parseDoubleQuoted(text: string): string | null {
  let end = -1;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '"') {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const quoted = text.slice(0, end + 1);
  try {
    const value: unknown = JSON.parse(quoted);
    if (typeof value === 'string') return value;
  } catch {
    // YAML-only escapes (\x41, \_ ...): fall back to the raw inner text.
  }
  return text.slice(1, end);
}

/** A YAML single-quoted scalar: `''` is one quote. */
function parseSingleQuoted(text: string): string | null {
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return out;
      }
    } else {
      out += ch;
    }
  }
  return null;
}

/** One YAML scalar value as text, or null when empty, null, or not a scalar we use. */
export function parseScalar(raw: string): string | null {
  const text = raw.trim();
  let value: string | null;
  if (text.startsWith('"')) {
    value = parseDoubleQuoted(text);
  } else if (text.startsWith("'")) {
    value = parseSingleQuoted(text);
  } else if (text === '' || '[{|>&*!%@`#'.includes(text.charAt(0))) {
    // Empty, a flow collection, a block scalar, an anchor, a tag or a comment.
    value = null;
  } else {
    const plain = text.replace(/\s+#.*$/, '').trim();
    value = /^(~|null)$/i.test(plain) ? null : plain;
  }
  return value === null || value === '' ? null : value;
}

type FrontmatterResult =
  | { status: 'none' }
  | { status: 'open' } // starts a frontmatter block that is not closed in this text
  | { status: 'ok'; values: HeadValues };

/** Parse the wanted top-level keys of a leading `---` block (first occurrence wins). */
export function parseFrontmatter(head: string): FrontmatterResult {
  const text = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head; // drop a BOM
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? '').trimEnd() !== '---') return { status: 'none' };
  const values: HeadValues = {
    type: null,
    fvtt_uuid: null,
    fvtt_sig: null,
    fvtt_journal: null,
    name: null,
    folder: null,
    generated_by: null,
  };
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trimEnd();
    if (trimmed === '---' || trimmed === '...') return { status: 'ok', values };
    const match = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    if (key === undefined || !KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    values[key as keyof HeadValues] = parseScalar(match[2] ?? '');
  }
  return { status: 'open' };
}

/** The leading frontmatter values of a note file, or null when it has none. */
async function readFrontmatter(full: string): Promise<HeadValues | null> {
  const handle = await fsp.open(full, 'r');
  try {
    const head = Buffer.alloc(SCAN_HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, SCAN_HEAD_BYTES, 0);
    let parsed = parseFrontmatter(head.toString('utf8', 0, bytesRead));
    if (parsed.status === 'open' && bytesRead === SCAN_HEAD_BYTES) {
      // The block may continue: follow it, up to the hard limit.
      const wide = Buffer.alloc(SCAN_FRONTMATTER_MAX_BYTES);
      const more = await handle.read(wide, 0, SCAN_FRONTMATTER_MAX_BYTES, 0);
      parsed = parseFrontmatter(wide.toString('utf8', 0, more.bytesRead));
    }
    return parsed.status === 'ok' ? parsed.values : null;
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function insideFence(relPath: string): boolean {
  return relPath.startsWith(FENCE_PREFIX);
}

interface Walk {
  maxDepth: number;
  maxFiles: number;
  fileCount: number;
  markdown: string[];
  takenPaths: Set<string>;
  limitsHit: Set<'files' | 'depth'>;
  errors: Array<{ path: string; error: string }>;
}

async function walk(dirFull: string, dirRel: string, depth: number, state: Walk): Promise<void> {
  let names: string[];
  try {
    names = (await fsp.readdir(dirFull)).sort(byCodeUnits);
  } catch (error) {
    state.errors.push({ path: dirRel, error: errorMessage(error) });
    return;
  }
  for (const name of names) {
    if (state.fileCount >= state.maxFiles) {
      state.limitsHit.add('files');
      return;
    }
    const full = `${dirFull}/${name}`;
    const rel = dirRel === '' ? name : `${dirRel}/${name}`;
    let stat: Stats;
    try {
      stat = await fsp.lstat(full);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        state.errors.push({ path: rel, error: errorMessage(error) });
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Never followed; inside the fence it still occupies the name.
      if (insideFence(rel)) state.takenPaths.add(pathKey(rel));
    } else if (stat.isDirectory()) {
      if (name.startsWith('.')) continue; // .trash, .obsidian, .git ...
      // The Library and the image copies have their own scan (thousands of files, no mirror notes).
      if (rel === LIBRARY_ROOT || rel === ATTACHMENTS_ROOT) continue;
      if (depth >= state.maxDepth) {
        state.limitsHit.add('depth');
        continue;
      }
      await walk(full, rel, depth + 1, state);
    } else if (stat.isFile()) {
      state.fileCount++;
      if (insideFence(rel)) state.takenPaths.add(pathKey(rel));
      if (!name.startsWith('.') && /\.md$/i.test(name)) state.markdown.push(rel);
    }
  }
}

/** Run `fn` over `items` with a small pool, keeping result order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type Classified =
  | { kind: 'mirror'; note: ScannedNote }
  | { kind: 'prep'; uuid: string; path: string }
  | { kind: 'stats'; uuid: string; path: string }
  | { kind: 'ignore' }
  | { kind: 'error'; error: string };

const IGNORE: Classified = { kind: 'ignore' };

function isPrepType(type: string): boolean {
  return type === 'session-plan' || type.endsWith('-prep');
}

async function classify(root: string, rel: string): Promise<Classified> {
  const full = `${root}/${rel}`;
  try {
    const head = await readFrontmatter(full);
    const type = head?.type;
    const uuid = head?.fvtt_uuid;
    if (!head || !type || !uuid) return IGNORE;
    if (
      head.generated_by === GENERATED_BY &&
      (MIRROR_NOTE_TYPES as readonly string[]).includes(type)
    ) {
      const text = await fsp.readFile(full, 'utf8');
      return {
        kind: 'mirror',
        note: {
          path: rel,
          uuid,
          type,
          sig: head.fvtt_sig,
          insideFence: insideFence(rel),
          owned: checkMarkdownOwnership(text).owned,
          name: head.name,
          journalUuid: head.fvtt_journal,
          folder: head.folder,
        },
      };
    }
    if (type === 'pc-stats') return { kind: 'stats', uuid, path: rel };
    if (isPrepType(type)) return { kind: 'prep', uuid, path: rel };
    return IGNORE;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return IGNORE; // deleted while scanning
    return { kind: 'error', error: errorMessage(error) };
  }
}

/** 0: inside the fence and unedited; 1: inside the fence; 2: outside (moved by the GM). */
function rank(note: ScannedNote): number {
  if (note.insideFence) return note.owned ? 0 : 1;
  return 2;
}

/** The winner per uuid (best rank, then path order); the rest are duplicates. */
function pickWinners(sorted: ScannedNote[], duplicates: ScannedNote[]): Map<string, ScannedNote> {
  const winners = new Map<string, ScannedNote>();
  for (const note of sorted) {
    const current = winners.get(note.uuid);
    if (!current) {
      winners.set(note.uuid, note);
    } else if (rank(note) < rank(current)) {
      winners.set(note.uuid, note);
      duplicates.push(current);
    } else {
      duplicates.push(note);
    }
  }
  return winners;
}

/**
 * Scan one world's campaign folder. An absent folder gives an empty scan; a
 * campaign folder that is itself a link is not followed (recorded in `errors`).
 */
export async function scanCampaign(
  vaultDir: string,
  worldId: string,
  options: ScanOptions = {}
): Promise<MirrorScan> {
  const root = campaignDir(vaultDir, worldId).replace(/\\/g, '/');
  const state: Walk = {
    maxDepth: options.maxDepth ?? SCAN_MAX_DEPTH,
    maxFiles: options.maxFiles ?? SCAN_MAX_FILES,
    fileCount: 0,
    markdown: [],
    takenPaths: new Set(),
    limitsHit: new Set(),
    errors: [],
  };
  const scan: MirrorScan = {
    mirror: new Map(),
    pages: new Map(),
    prep: new Map(),
    stats: new Map(),
    movedByGm: [],
    duplicates: [],
    takenPaths: state.takenPaths,
    fileCount: 0,
    limitsHit: [],
    errors: state.errors,
  };

  const rootStat = await fsp.lstat(root).catch(error => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  if (!rootStat) return scan;
  if (rootStat.isSymbolicLink()) {
    state.errors.push({ path: '', error: 'The campaign folder is a link; not scanned' });
    return scan;
  }
  if (!rootStat.isDirectory()) return scan;

  await walk(root, '', 0, state);
  scan.fileCount = state.fileCount;
  scan.limitsHit = [...state.limitsHit].sort();

  const markdown = state.markdown.sort(byCodeUnits);
  const classified = await mapLimit(markdown, READ_CONCURRENCY, rel => classify(root, rel));
  const topLevel: ScannedNote[] = [];
  const pageNotes: ScannedNote[] = [];
  classified.forEach((entry, index) => {
    const rel = markdown[index] ?? '';
    if (entry.kind === 'mirror') {
      (entry.note.type === 'journal-page' ? pageNotes : topLevel).push(entry.note);
    } else if (entry.kind === 'prep') {
      if (!scan.prep.has(entry.uuid)) scan.prep.set(entry.uuid, entry.path);
    } else if (entry.kind === 'stats') {
      if (!scan.stats.has(entry.uuid)) scan.stats.set(entry.uuid, entry.path);
    } else if (entry.kind === 'error') {
      scan.errors.push({ path: rel, error: entry.error });
    }
  });

  const duplicates: ScannedNote[] = [];
  const mirror = pickWinners(topLevel, duplicates);
  const pages = pickWinners(pageNotes, duplicates);
  duplicates.sort((a, b) => byCodeUnits(a.path, b.path));
  const moved = [...mirror.values(), ...pages.values()]
    .filter(note => !note.insideFence)
    .sort((a, b) => byCodeUnits(a.path, b.path));

  // Deterministic map order: by path, not by the order winners were found.
  const inPathOrder = (map: Map<string, ScannedNote>): Map<string, ScannedNote> =>
    new Map([...map].sort(([, a], [, b]) => byCodeUnits(a.path, b.path)));
  scan.mirror = inPathOrder(mirror);
  scan.pages = inPathOrder(pages);
  scan.movedByGm = moved;
  scan.duplicates = duplicates;
  return scan;
}
