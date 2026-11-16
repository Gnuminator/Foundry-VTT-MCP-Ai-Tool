/**
 * Encounter blocks in a Prep note (O6 read side, I-052): the Initiative Tracker `encounter` code
 * block the Encounter template carries, read as a suggested encounter. Pure text in, plain data
 * out: nothing here writes, and the note's other text (properties, `secret`, prose) is never kept.
 */
import {
  PREP_ENCOUNTER_MAX_BLOCKS,
  PREP_ENCOUNTER_MAX_CREATURES,
  type PrepEncounter,
} from '@gnuminator/shared';

const NAME_CHARS = 60;
const MAX_COUNT = 50;

const clip = (text: string): string =>
  text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS - 1)}…` : text;

/** A creature or encounter name: wikilink and quotes removed. */
function cleanName(raw: string): string {
  return raw
    .trim()
    .replace(/^\[\[([^\]|]*\|)?([^\]]+)\]\]$/, '$2')
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
}

/**
 * One `creatures` entry: `2: Goblin`, `Goblin`, `2: [Goblin, 7, 15]`, `[2, Goblin]` or
 * `Goblin, 7, 15` (hit points and the rest are ignored). Null when no name is left.
 */
export function parseCreatureEntry(entry: string): { name: string; count: number } | null {
  let text = entry.trim();
  let count = 1;
  const counted = /^(\d{1,3})\s*:\s*(.+)$/.exec(text);
  if (counted?.[1] !== undefined && counted[2] !== undefined) {
    count = Number(counted[1]);
    text = counted[2].trim();
  }
  const bracket = text.startsWith('[[') ? null : /^\[(.*)\]$/.exec(text);
  const parts = (bracket?.[1] ?? text).split(',').map(p => p.trim());
  let head = parts[0] ?? '';
  if (bracket && /^\d{1,3}$/.test(head) && parts[1]) {
    count = Number(head);
    head = parts[1];
  }
  const name = cleanName(head);
  if (name === '' || /^\d+\s*:$/.test(name) || count < 1) return null;
  return { name: clip(name), count: Math.min(count, MAX_COUNT) };
}

/** The bodies of the fenced `encounter` blocks in a note, in order. */
function blockBodies(text: string): string[] {
  const bodies: string[] = [];
  let fence: string | null = null;
  let current: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence === null) {
      const open = /^\s*(`{3,}|~{3,})\s*encounter\s*$/i.exec(line);
      if (open?.[1]) {
        fence = open[1];
        current = [];
      }
    } else {
      const ch = fence.startsWith('`') ? '`' : '~';
      if (new RegExp(`^\\s*${ch}{${fence.length},}\\s*$`).test(line)) {
        bodies.push(current.join('\n'));
        fence = null;
      } else {
        current.push(line);
      }
    }
  }
  return bodies;
}

/** Strip `%% ... %%` Obsidian comments (an unclosed one hides the rest). */
const withoutComments = (text: string): string => text.replace(/%%[\s\S]*?(%%|$)/g, '');

/**
 * The suggested encounters in one note's text, at most PREP_ENCOUNTER_MAX_BLOCKS. A block without
 * a creature is skipped. `fallbackName` names a block that has no `name:` line.
 */
export function parseEncounterBlocks(text: string, fallbackName: string): PrepEncounter[] {
  const body0 = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: PrepEncounter[] = [];
  for (const body of blockBodies(withoutComments(body0))) {
    if (out.length >= PREP_ENCOUNTER_MAX_BLOCKS) break;
    let name = '';
    let inCreatures = false;
    const entries: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trimEnd();
      const key = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
      if (key?.[1] !== undefined) {
        inCreatures = key[1] === 'creatures';
        if (key[1] === 'name') name = cleanName(key[2] ?? '');
        continue;
      }
      const item = /^\s*-\s+(.*)$/.exec(line);
      if (inCreatures && item?.[1] !== undefined) entries.push(item[1]);
    }
    const parsed = entries.flatMap(e => {
      const creature = parseCreatureEntry(e);
      return creature ? [creature] : [];
    });
    if (parsed.length === 0) continue;
    out.push({
      name: clip(name === '' ? fallbackName : name),
      creatures: parsed.slice(0, PREP_ENCOUNTER_MAX_CREATURES),
      total: parsed.reduce((sum, c) => sum + c.count, 0),
      truncated: parsed.length > PREP_ENCOUNTER_MAX_CREATURES,
    });
  }
  return out;
}
