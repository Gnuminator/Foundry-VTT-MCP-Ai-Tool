/**
 * "New prep note for this" (R2, D-094): from a mirror note (an NPC, a scene, a quest journal) make
 * `Campaigns/<world>/Prep/<kind folder>/<name>.md` from the vault's template of that kind
 * (`Prep/Templates/`, which the export writes once; `packages/mcp-server/src/obsidian/
 * prep-templates.ts`), with `fvtt_uuid` filled in and a link back. The prep digest (R3) then
 * finds the note by its `fvtt_uuid`. No `obsidian` import, so this runs in node tests.
 */

export interface PrepKind {
  id: 'npc' | 'location' | 'quest' | 'session';
  /** What the picker shows. */
  label: string;
  /** The template's file name in `Prep/Templates/`. */
  template: string;
  /** The folder under `Prep/` the new note goes into. */
  folder: string;
  /** The note's `type`, as the prep digest reads it. */
  type: string;
}

export const PREP_KINDS: readonly PrepKind[] = [
  { id: 'npc', label: 'NPC prep', template: 'NPC.md', folder: 'NPCs', type: 'npc-prep' },
  {
    id: 'location',
    label: 'Location prep',
    template: 'Location.md',
    folder: 'Locations',
    type: 'location-prep',
  },
  { id: 'quest', label: 'Quest prep', template: 'Quest.md', folder: 'Quests', type: 'quest-prep' },
  {
    id: 'session',
    label: 'Session plan',
    template: 'Session plan.md',
    folder: 'Session plans',
    type: 'session-plan',
  },
];

/** The mirror note `type` to the kind offered first; the others follow in PREP_KINDS order. */
const FIRST_KIND: Record<string, PrepKind['id']> = {
  pc: 'npc',
  npc: 'npc',
  scene: 'location',
  journal: 'quest',
  'journal-page': 'quest',
  'story-item': 'quest',
};

const FIRST_BY_FOUNDRY_TYPE: Record<string, PrepKind['id']> = {
  Actor: 'npc',
  Scene: 'location',
  JournalEntry: 'quest',
  JournalEntryPage: 'quest',
};

/** The kinds for the picker, the likely one first (by the mirror `type`, else the Foundry type). */
export function prepKindsFor(noteType: string | null, foundryType: string): PrepKind[] {
  const first =
    (noteType ? FIRST_KIND[noteType] : undefined) ?? FIRST_BY_FOUNDRY_TYPE[foundryType] ?? 'npc';
  return [...PREP_KINDS].sort((a, b) => Number(b.id === first) - Number(a.id === first));
}

/**
 * The uuid the prep note points at: the note's own, except that quest prep on a journal page
 * points at its journal (the prep digest matches open quest journals, not pages).
 */
export function prepUuid(kind: PrepKind, uuid: string): string {
  if (kind.id !== 'quest') return uuid;
  return /^(JournalEntry\.[A-Za-z0-9]+)\.JournalEntryPage\.[A-Za-z0-9]+$/.exec(uuid)?.[1] ?? uuid;
}

/** A GM prep note type (`session-plan` or ending in `-prep`), as the prep digest reads it. */
export function isPrepType(type: unknown): boolean {
  return typeof type === 'string' && (type === 'session-plan' || type.endsWith('-prep'));
}

/**
 * The campaign folder a mirror note lives in (`Campaigns/<world>`), or null when the note is not
 * in its world's campaign folder (then there is no Prep folder to write to).
 */
export function campaignRootOf(notePath: string, world: string | null): string | null {
  if (!world || /[\\/]/.test(world)) return null;
  const root = `Campaigns/${world}`;
  return notePath.startsWith(`${root}/`) ? root : null;
}

/** Windows device names, alone or before a dot: `CON.md` or `aux.notes.md` cannot be made there. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;

/** Spaces collapsed, no leading or trailing dots or spaces. */
function tidyName(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

/** A note name safe as an Obsidian file name on every OS: no link-breaking, reserved or control
 * characters, no leading or trailing dots (also after the cut), not a Windows device name. */
export function prepFileName(name: string | null): string {
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\u0000-\u001f\u007f\\/:*?"<>|#^[\]%]/g;
  const safe = tidyName(tidyName((name ?? '').replace(unsafe, ' ')).slice(0, 100));
  if (!safe) return 'Untitled';
  return safe.replace(RESERVED_NAME, '$1_');
}

/** `YYYY-MM-DD` in local time. */
export function localDate(day: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** A vault note as the prep lookup sees it: its path and frontmatter. */
export interface PrepLookupNote {
  path: string;
  frontmatter: Record<string, unknown> | undefined;
}

/**
 * The prep note already there for this uuid and type anywhere under `<root>/Prep/` (also one the
 * GM moved or renamed, and `Prep` in another letter case), leaving out `Prep/Templates/`; or null.
 */
export function findPrepNote(
  notes: Iterable<PrepLookupNote>,
  root: string,
  uuid: string,
  type: string
): string | null {
  const prefix = `${root}/prep/`.toLowerCase();
  const templates = `${prefix}templates/`;
  for (const note of notes) {
    const lower = note.path.toLowerCase();
    if (!lower.startsWith(prefix) || lower.startsWith(templates)) continue;
    if (note.frontmatter?.type === type && note.frontmatter.fvtt_uuid === uuid) return note.path;
  }
  return null;
}

/** The paths to try in turn: `<folder>/<name>.md`, then `<name> 2.md` and so on. */
export function prepPathCandidates(folder: string, name: string, count = 20): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? `${folder}/${name}.md` : `${folder}/${name} ${i + 1}.md`
  );
}

const FRONTMATTER = /^---\n(?:---|([\s\S]*?)\n---)(?:\n|$)/;

/** Set `key: value` in frontmatter lines: replaces the key's line and its block list or indented
 * lines, or adds the line first when the key is missing. */
function setProperty(lines: string[], key: string, value: string): void {
  const line = `${key}: ${value}`;
  const at = lines.findIndex(l => l.startsWith(`${key}:`));
  if (at < 0) {
    lines.unshift(line);
    return;
  }
  let end = at + 1;
  while (end < lines.length && /^(\s|-(\s|$))/.test(lines[end] ?? '')) end++;
  lines.splice(at, end - at, line);
}

/**
 * The new note's text: the template (or a bare one when the vault has none) with `type` kept
 * (set when missing), `fvtt_uuid` set to the uuid, and a "Prep for <link>." line first in the body.
 */
export function fillPrepNote(
  template: string | null,
  fill: { type: string; uuid: string; link: string; date?: string }
): string {
  const text = (template ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = FRONTMATTER.exec(text);
  const inner = match?.[1];
  const lines = match
    ? inner === undefined
      ? []
      : inner.split('\n')
    : ['ai_context: true', 'secret:'];
  const body = match ? text.slice(match[0].length) : text;

  setProperty(lines, 'fvtt_uuid', `'${fill.uuid}'`);
  if (fill.date !== undefined) setProperty(lines, 'date', fill.date);
  if (!lines.some(line => /^type:/.test(line))) lines.unshift(`type: ${fill.type}`);

  const rest = body.replace(/^\n+/, '');
  return ['---', ...lines, '---', `Prep for ${fill.link}.`, '', rest]
    .join('\n')
    .replace(/\n*$/, '\n');
}
