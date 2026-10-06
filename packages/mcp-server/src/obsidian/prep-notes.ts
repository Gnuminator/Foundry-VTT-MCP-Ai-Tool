/**
 * The GM's prep notes as AI context (R3, "O5-lite"; vault note
 * `Design/I-118 Obsidian slice review 2026-10-06.md`). Read-only.
 *
 * Finds prep notes by their properties (`type` `session-plan` or ending in
 * `-prep`, see `isPrepType`) with the mirror scan's walker, outside the tool's
 * own `AI Tool/` folder, and picks:
 *
 * - the newest `session-plan` note (by its `date` property, else the file time);
 * - the notes whose `fvtt_uuid` is one of the wanted uuids (the current scene,
 *   the actors with tokens on it, the open quest journals), in that order.
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
} from './mirror-scan.js';
import { errorCode, errorMessage } from './note-writer.js';

/** A note is read up to this many bytes; the rest counts as truncated. */
export const PREP_NOTE_READ_BYTES = 65_536;

const READ_CONCURRENCY = 16;
/** The tool's own folder (mirror, session notes, stats): never the GM's prep. */
const TOOL_FOLDER = MIRROR_ROOT.split('/')[0] ?? MIRROR_ROOT;
const SYNC_CONFLICT = /\.sync-conflict-/i;
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
}

export interface ReadPrepNotesResult {
  part: PrepNotesPart;
  /** Folders or notes that could not be read (campaign-relative path: error). */
  errors: string[];
}

interface Candidate {
  path: string;
  head: HeadValues;
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

/**
 * A prep note as lines: its properties ("key: value", meta properties left out),
 * then the non-empty body lines, each clipped, at most PREP_NOTE_MAX_LINES.
 */
export function prepNoteLines(text: string): { lines: string[]; truncated: boolean } {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = source.split(/\r?\n/);
  const properties: string[] = [];
  let bodyStart = 0;
  if ((all[0] ?? '').trimEnd() === '---') {
    let end = all.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
    if (end < 0) end = all.length;
    bodyStart = end + 1;
    const block = all.slice(1, end);
    for (let i = 0; i < block.length; i++) {
      const match = /^([A-Za-z_][\w -]*):(?:[ \t]+(.*))?$/.exec((block[i] ?? '').trimEnd());
      if (!match?.[1]) continue;
      const following: string[] = [];
      for (let j = i + 1; j < block.length && /^\s/.test(block[j] ?? ''); j++) {
        following.push(block[j] ?? '');
      }
      const key = match[1].trim();
      if (META_PROPERTIES.has(key)) continue;
      const value = propertyValue(match[2] ?? '', following);
      if (value !== null) properties.push(`${key}: ${value}`);
    }
  }
  const body = all
    .slice(bodyStart)
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

/** Sort key for "newest": the `date` property when it parses, else the file time. */
async function planTime(root: string, note: Candidate): Promise<number> {
  const fromDate = note.head.date ? Date.parse(note.head.date) : NaN;
  if (Number.isFinite(fromDate)) return fromDate;
  const stat = await fsp.stat(`${root}/${note.path}`).catch(() => null);
  return stat?.mtimeMs ?? 0;
}

/** Find, pick and read the prep notes for the digest. Throws only when the walk itself fails. */
export async function readPrepNotes(input: ReadPrepNotesInput): Promise<ReadPrepNotesResult> {
  const walked = await walkCampaign(input.vaultDir, input.worldId, {
    skipDir: rel => rel === TOOL_FOLDER,
  });
  const errors = walked.errors.map(e => `${e.path || '(campaign folder)'}: ${e.error}`);
  const files = walked.markdown.filter(rel => !SYNC_CONFLICT.test(rel));
  const heads = await mapLimit(files, READ_CONCURRENCY, async rel => {
    try {
      return await readFrontmatter(`${walked.root}/${rel}`);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') errors.push(`${rel}: ${errorMessage(error)}`);
      return null;
    }
  });
  const candidates: Candidate[] = [];
  heads.forEach((head, index) => {
    const rel = files[index];
    if (head?.type && rel !== undefined && isPrepType(head.type))
      candidates.push({ path: rel, head });
  });

  let keptOut = 0;
  const picked: Array<{ note: Candidate; reason: PrepNoteReason; matched: string | null }> = [];

  // The newest session plan the GM lets the AI read.
  const plans = candidates.filter(c => c.head.type === 'session-plan');
  const timed = await Promise.all(
    plans.map(async note => ({ note, time: await planTime(walked.root, note) }))
  );
  timed.sort((a, b) => b.time - a.time); // stable: path order on ties
  for (const { note } of timed) {
    if (isOff(note.head.ai_context)) {
      keptOut++;
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
    const taken = new Set(picked.map(p => p.note.path));
    const matches = candidates
      .map(note => ({
        note,
        index: note.head.fvtt_uuid ? order.get(normalizeUuid(note.head.fvtt_uuid)) : undefined,
      }))
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
      fvttUuid: note.head.fvtt_uuid ? normalizeUuid(note.head.fvtt_uuid) : null,
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
