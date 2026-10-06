/**
 * The GM's prep notes as AI context (R3, "O5-lite"; vault note
 * `Design/I-118 Obsidian slice review 2026-10-06.md`). Read-only.
 *
 * Finds prep notes by their properties (`type` `session-plan` or ending in
 * `-prep`, see `isPrepType`) with the mirror scan's walker, outside the tool's
 * own `AI Tool/` folder, and picks:
 *
 * - the newest `session-plan` note (by its `date` property, else the file time);
 * - the notes whose `fvtt_uuid` (one uuid, a `@UUID[...]` link or a list) is one
 *   of the wanted uuids (the current scene, the tokens and actors on it, the open
 *   quest journals), in that order; see `matchKeys` for unlinked tokens.
 *
 * Notes with `ai_context: false` are left out and counted; Syncthing conflict
 * copies (`*.sync-conflict-*`) are skipped. Each note becomes at most
 * PREP_NOTE_MAX_LINES lines (properties, then body) within total caps. The text
 * is the GM's own: callers mark it as data (PREP_NOTES_NOTICE).
 */
import { promises as fsp } from 'fs';

import {
  PREP_NOTE_MAX_LINE_CHARS,
  PREP_NOTE_MAX_LINES,
  PREP_NOTES_MAX,
  PREP_NOTES_MAX_TOTAL_LINES,
  PREP_NOTES_NOTICE,
  type PrepNote,
  type PrepNoteReason,
  type PrepNotesPart,
} from '@gnuminator/shared';

import { MIRROR_ROOT } from './mirror-common.js';
import {
  isPrepType,
  mapLimit,
  parseScalar,
  readFrontmatter,
  walkCampaign,
  type HeadValues,
  type ScanOptions,
} from './mirror-scan.js';
import { errorCode, errorMessage } from './note-writer.js';
import { PREP_TEMPLATES_DIR } from './prep-templates.js';

/** A note is read up to this many bytes; the rest counts as truncated. */
export const PREP_NOTE_READ_BYTES = 65_536;
/** How much of a prep note is read to find an fvtt_uuid the scan's parser skipped. */
const UUID_READ_BYTES = 16_384;

const READ_CONCURRENCY = 16;
/** The tool's own folder (mirror, session notes, stats): never the GM's prep. */
const TOOL_FOLDER = MIRROR_ROOT.split('/')[0] ?? MIRROR_ROOT;
const SYNC_CONFLICT = /\.sync-conflict-/i;
/** The prep templates (R2): they carry prep types but are not prep notes. */
const TEMPLATES_PREFIX = `${PREP_TEMPLATES_DIR.toLowerCase()}/`;
/** Properties that say what a note is, not what it says. */
const META_PROPERTIES: ReadonlySet<string> = new Set([
  'type',
  'fvtt_uuid',
  'ai_context',
  'tags',
  'aliases',
  'cssclasses',
  'schema',
  'generated_by',
  'generated_at',
  'fvtt_world',
  'fvtt_modified',
  'fvtt_sig',
]);

/** A uuid to look for and why. */
export interface WantedUuid {
  uuid: string;
  reason: Exclude<PrepNoteReason, 'session-plan'>;
  /** The scene, token or quest name, for the reader. */
  matched: string;
}

export interface ReadPrepNotesInput {
  vaultDir: string;
  worldId: string;
  /** In priority order (scene, actors, quests); null when Foundry did not say. */
  wanted: WantedUuid[] | null;
  matchedAgainst: PrepNotesPart['matchedAgainst'];
  /** Walk limits; the scan's defaults when absent (tests lower them). */
  limits?: ScanOptions;
}

export interface ReadPrepNotesResult {
  part: PrepNotesPart;
  /** Folders or notes that could not be read (campaign-relative path: error). */
  errors: string[];
}

interface Candidate {
  path: string;
  head: HeadValues;
  /** The note's fvtt_uuid values, normalised; empty when it has none. */
  uuids: string[];
}

function isOff(value: string | null): boolean {
  return value !== null && /^(false|no|off|0)$/i.test(value.trim());
}

/** "Actor.abc", also when pasted as a link: `@UUID[Actor.abc]{Name}`. */
export function normalizeUuid(raw: string): string {
  const text = raw.trim();
  const link = /^@UUID\[([^\]]+)\]/.exec(text);
  return (link?.[1] ?? text).trim();
}

/**
 * The wanted uuids a note's uuid can match. An unlinked token's sheet copies
 * `Scene.S.Token.T.Actor.A` (its synthetic actor): that also matches the token
 * and the base actor, so a note for one goblin covers every goblin token.
 */
export function matchKeys(uuid: string): string[] {
  const synthetic = /^(Scene\.[^.]+\.Token\.[^.]+)\.Actor\.([^.]+)$/.exec(uuid);
  return synthetic?.[1] && synthetic[2] ? [uuid, synthetic[1], `Actor.${synthetic[2]}`] : [uuid];
}

/** The lines of a leading `---` block and where the body starts; null without one. */
function frontmatterBlock(all: string[]): { block: string[]; bodyStart: number } | null {
  if ((all[0] ?? '').trimEnd() !== '---') return null;
  let end = all.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
  if (end < 0) end = all.length;
  return { block: all.slice(1, end), bodyStart: end + 1 };
}

/** A list item or scalar as text: parsed when it is valid YAML, else as written. */
function rawItem(raw: string): string {
  return parseScalar(raw) ?? raw.trim();
}

/**
 * The lines after the property on line `at` that belong to it: indented lines,
 * plus column-0 "- item" lines when the property is a block list (valid YAML).
 */
function followingLines(block: string[], at: number, listOk: boolean): string[] {
  const following: string[] = [];
  for (let j = at + 1; j < block.length; j++) {
    const line = block[j] ?? '';
    if (!/^\s/.test(line) && !(listOk && /^-(\s|$)/.test(line))) break;
    following.push(line);
  }
  return following;
}

/**
 * The `fvtt_uuid` values as the GM wrote them, for what the scan's scalar
 * parser leaves out: an unquoted `@UUID[Actor.a]{Name}` link, a flow list or a
 * block list. Normalised, empty ones dropped.
 */
export function rawUuids(text: string): string[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const block = frontmatterBlock(source.split(/\r?\n/))?.block ?? [];
  const at = block.findIndex(l => /^fvtt_uuid:(\s|$)/.test(l));
  if (at < 0) return [];
  const value = (block[at] ?? '').slice('fvtt_uuid:'.length).trim();
  let items: string[];
  if (value === '') {
    items = [];
    for (const line of followingLines(block, at, true)) {
      const item = /^\s*-\s+(.*)$/.exec(line)?.[1];
      if (item !== undefined) items.push(rawItem(item));
    }
  } else if (value.startsWith('[') && value.endsWith(']')) {
    items = value.slice(1, -1).split(',').map(rawItem);
  } else {
    items = [rawItem(value)];
  }
  return items.map(normalizeUuid).filter(Boolean);
}

function clip(line: string): string {
  return line.length > PREP_NOTE_MAX_LINE_CHARS
    ? `${line.slice(0, PREP_NOTE_MAX_LINE_CHARS - 3)}...`
    : line;
}

/** A property value as one line: scalars, flow lists and block lists; null when empty. */
function propertyValue(raw: string, following: string[]): string | null {
  const text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    const items = text
      .slice(1, -1)
      .split(',')
      .map(item => parseScalar(item))
      .filter((item): item is string => item !== null);
    return items.length > 0 ? items.join(', ') : null;
  }
  if (text === '|' || text === '>' || /^[|>][+-]?$/.test(text)) {
    const block = following.map(l => l.trim()).filter(Boolean);
    return block.length > 0 ? block.join(' ') : null;
  }
  if (text === '') {
    const items = following
      .map(l => /^\s*-\s+(.*)$/.exec(l)?.[1])
      .filter((item): item is string => item !== undefined)
      .map(item => parseScalar(item))
      .filter((item): item is string => item !== null);
    return items.length > 0 ? items.join(', ') : null;
  }
  return parseScalar(text);
}

/** Body text without Obsidian comments (`%% ... %%`, an unclosed one runs to the end), as the GM sees it. */
function withoutComments(text: string): string {
  return text.replace(/%%[\s\S]*?(%%|$)/g, '');
}

/**
 * A prep note as lines: its properties ("key: value", meta properties left out),
 * then the non-empty body lines, each clipped, at most PREP_NOTE_MAX_LINES.
 */
export function prepNoteLines(text: string): { lines: string[]; truncated: boolean } {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = source.split(/\r?\n/);
  const properties: string[] = [];
  const front = frontmatterBlock(all);
  const bodyStart = front?.bodyStart ?? 0;
  if (front) {
    const { block } = front;
    for (let i = 0; i < block.length; i++) {
      const match = /^([A-Za-z_][\w -]*):(?:[ \t]+(.*))?$/.exec((block[i] ?? '').trimEnd());
      if (!match?.[1]) continue;
      const following = followingLines(block, i, (match[2] ?? '').trim() === '');
      const key = match[1].trim();
      if (META_PROPERTIES.has(key)) continue;
      const value = propertyValue(match[2] ?? '', following);
      if (value !== null) properties.push(`${key}: ${value}`);
    }
  }
  const body = withoutComments(all.slice(bodyStart).join('\n'))
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const lines = [...properties, ...body].map(clip);
  return {
    lines: lines.slice(0, PREP_NOTE_MAX_LINES),
    truncated: lines.length > PREP_NOTE_MAX_LINES,
  };
}

async function readHead(full: string, size: number): Promise<{ text: string; cut: boolean }> {
  const handle = await fsp.open(full, 'r');
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    const stat = await handle.stat();
    return { text: buffer.toString('utf8', 0, bytesRead), cut: stat.size > bytesRead };
  } finally {
    await handle.close();
  }
}

/**
 * An undated session plan whose body is only headings (an untouched template copy, for example
 * in a renamed templates folder): it must not win "newest" by its file time.
 */
async function isBlankPlan(root: string, note: Candidate): Promise<boolean> {
  if (note.head.date && Number.isFinite(Date.parse(note.head.date))) return false;
  const { text } = await readHead(`${root}/${note.path}`, UUID_READ_BYTES).catch(() => ({
    text: '',
  }));
  const all = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  const body = withoutComments(all.slice(frontmatterBlock(all)?.bodyStart ?? 0).join('\n'));
  return body.split('\n').every(line => !line.trim() || /^\s*#/.test(line));
}

/** Sort keys for "newest": the `date` property when it parses, else the file time; then the
 * file time, so of two plans for the same game night the one written last wins. */
async function planTime(root: string, note: Candidate): Promise<{ time: number; mtime: number }> {
  const stat = await fsp.stat(`${root}/${note.path}`).catch(() => null);
  const mtime = stat?.mtimeMs ?? 0;
  const fromDate = note.head.date ? Date.parse(note.head.date) : NaN;
  return { time: Number.isFinite(fromDate) ? fromDate : mtime, mtime };
}

/** Find, pick and read the prep notes for the digest. Throws only when the walk itself fails. */
export async function readPrepNotes(input: ReadPrepNotesInput): Promise<ReadPrepNotesResult> {
  const walked = await walkCampaign(input.vaultDir, input.worldId, {
    ...input.limits,
    skipDir: rel => rel === TOOL_FOLDER,
  });
  const errors = walked.errors.map(e => `${e.path || '(campaign folder)'}: ${e.error}`);
  for (const limit of walked.limitsHit) {
    errors.push(
      `(campaign folder): the walk stopped at its ${limit === 'files' ? 'file' : 'folder depth'} limit, so some notes were not looked at`
    );
  }
  const files = walked.markdown.filter(
    rel => !SYNC_CONFLICT.test(rel) && !rel.toLowerCase().startsWith(TEMPLATES_PREFIX)
  );
  const heads = await mapLimit(files, READ_CONCURRENCY, async rel => {
    try {
      const head = await readFrontmatter(`${walked.root}/${rel}`);
      if (!head?.type || !isPrepType(head.type)) return null;
      if (head.fvtt_uuid) return { head, uuids: [normalizeUuid(head.fvtt_uuid)] };
      // The scan's parser skips a link, a list or a block: look at the raw text.
      const { text } = await readHead(`${walked.root}/${rel}`, UUID_READ_BYTES);
      return { head, uuids: rawUuids(text) };
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') errors.push(`${rel}: ${errorMessage(error)}`);
      return null;
    }
  });
  const candidates: Candidate[] = [];
  heads.forEach((found, index) => {
    const rel = files[index];
    if (found && rel !== undefined) candidates.push({ path: rel, ...found });
  });

  let keptOut = 0;
  /** Notes kept out by ai_context: false, so a note is counted once. */
  const keptOutPaths = new Set<string>();
  const picked: Array<{ note: Candidate; reason: PrepNoteReason; matched: string | null }> = [];

  // The newest session plan the GM lets the AI read.
  const allPlans = candidates.filter(c => c.head.type === 'session-plan');
  const blank = await Promise.all(allPlans.map(note => isBlankPlan(walked.root, note)));
  const plans = allPlans.filter((_, i) => !blank[i]);
  const timed = await Promise.all(
    plans.map(async note => ({ note, ...(await planTime(walked.root, note)) }))
  );
  timed.sort((a, b) => b.time - a.time || b.mtime - a.mtime); // stable: path order on ties
  for (const { note } of timed) {
    if (isOff(note.head.ai_context)) {
      keptOut++;
      keptOutPaths.add(note.path);
      continue;
    }
    picked.push({ note, reason: 'session-plan', matched: null });
    break;
  }

  // Notes for the scene, its actors and the open quests, in the caller's order.
  if (input.wanted) {
    const order = new Map<string, number>();
    input.wanted.forEach((w, i) => {
      if (!order.has(w.uuid)) order.set(w.uuid, i);
    });
    const taken = new Set([...picked.map(p => p.note.path), ...keptOutPaths]);
    const matches = candidates
      .map(note => {
        const indexes = note.uuids
          .flatMap(matchKeys)
          .map(key => order.get(key))
          .filter((i): i is number => i !== undefined);
        return { note, index: indexes.length > 0 ? Math.min(...indexes) : undefined };
      })
      .filter((m): m is { note: Candidate; index: number } => m.index !== undefined)
      .filter(m => !taken.has(m.note.path))
      .sort((a, b) => a.index - b.index); // stable: path order within one uuid
    for (const { note, index } of matches) {
      if (isOff(note.head.ai_context)) {
        keptOut++;
        continue;
      }
      const wanted = input.wanted[index];
      if (wanted) picked.push({ note, reason: wanted.reason, matched: wanted.matched });
    }
  }

  // Read in priority order until a cap is reached; the rest are counted.
  const notes: PrepNote[] = [];
  let usedLines = 0;
  let omitted = 0;
  for (const { note, reason, matched } of picked) {
    if (omitted > 0 || notes.length >= PREP_NOTES_MAX) {
      omitted++;
      continue;
    }
    let read: { text: string; cut: boolean };
    try {
      read = await readHead(`${walked.root}/${note.path}`, PREP_NOTE_READ_BYTES);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') errors.push(`${note.path}: ${errorMessage(error)}`);
      continue;
    }
    const { lines, truncated } = prepNoteLines(read.text);
    if (usedLines + lines.length > PREP_NOTES_MAX_TOTAL_LINES) {
      omitted++;
      continue;
    }
    usedLines += lines.length;
    notes.push({
      path: note.path,
      type: note.head.type ?? '',
      fvttUuid: note.uuids[0] ?? null,
      reason,
      matched,
      lines,
      truncated: truncated || read.cut,
    });
  }

  return {
    part: {
      notice: PREP_NOTES_NOTICE,
      notes,
      omitted,
      keptOut,
      matchedAgainst: input.matchedAgainst,
    },
    errors,
  };
}
