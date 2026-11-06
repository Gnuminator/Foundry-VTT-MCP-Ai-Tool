// The 2024 twin of a 2014 monster (read only). The GM picks a monster; the panel looks for the
// monster of the same name in the 2024 SRD 5.2 actors and shows both side by side. Nothing is
// converted and nothing is written. A monster with no clear twin says so instead of guessing.
//
// Twin rule (confidence):
//   1. The reviewed table below wins: it can name a twin under another name, or say "no twin".
//   2. Otherwise exactly one 2024 SRD actor with the same name (case, accents and a trailing
//      plural "s" ignored) is a clear twin. Anything else, including near names, is no twin.
// The 2024 text is read at run time from the dnd5e compendium; none of it is kept here.

/** The pack holding the 2024 SRD 5.2 monsters (dnd5e system, "Actors"). */
export const TWIN_PACK = 'dnd5e.actors24';

/** What the table says about a 2014 name: a twin under another name, or no twin and why. */
export type TableEntry = { twin: string } | { twin: null; reason: string; closest?: string };

/**
 * Reviewed table, keyed by normalised 2014 name. Named and setting monsters have no 2024 text;
 * `closest` is shown as a pointer only, never as a twin. Renames get added here after a check
 * against the 2024 pack.
 */
export const TWIN_TABLE: Readonly<Record<string, TableEntry>> = {
  'strahd von zarovich': {
    twin: null,
    reason:
      'Strahd is a named monster of the book: there is no 2024 version, and his lair actions and spells have no 2024 counterpart.',
    closest: 'Vampire',
  },
  wereraven: {
    twin: null,
    reason: 'The wereraven is a setting monster of the book; 2024 has no wereraven.',
    closest: 'Wererat',
  },
};

export type TwinVerdict =
  | { kind: 'twin'; name: string; how: 'name' | 'table' }
  | { kind: 'none'; reason: string; closest?: string }
  | { kind: 'already-2024' };

/** Lower case, accents and punctuation gone, one space between words, trailing plural s dropped. */
export function normalizeName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return base.length > 3 && base.endsWith('s') && !base.endsWith('ss') ? base.slice(0, -1) : base;
}

/**
 * The verdict for a 2014 monster. `candidates` are the names of the 2024 SRD actors the search
 * returned; `fromPack` is the pack the picked monster came from, if any.
 */
export function decideTwin(name: string, candidates: string[], fromPack?: string): TwinVerdict {
  if (fromPack === TWIN_PACK) return { kind: 'already-2024' };
  const key = normalizeName(name);
  const entry = TWIN_TABLE[key];
  if (entry?.twin === null) {
    return {
      kind: 'none',
      reason: entry.reason,
      ...(entry.closest ? { closest: entry.closest } : {}),
    };
  }
  const wanted = entry ? normalizeName(entry.twin) : key;
  const hits = candidates.filter(c => normalizeName(c) === wanted);
  const first = hits[0];
  if (first === undefined) {
    return {
      kind: 'none',
      reason:
        'No 2024 SRD monster has this name, so there is no clear twin. Run the 2014 stat block as it is.',
    };
  }
  if (hits.length > 1) {
    return {
      kind: 'none',
      reason: 'More than one 2024 monster has this name, so there is no single clear twin.',
    };
  }
  return { kind: 'twin', name: first, how: entry ? 'table' : 'name' };
}

/** Where a picked monster lives: a compendium entry or a world actor. */
export type MonsterRef =
  | { kind: 'compendium'; pack: string; id: string }
  | { kind: 'world'; id: string };

/** `Compendium.<scope>.<pack>.Actor.<id>` or `Actor.<id>`; anything else is not a monster. */
export function parseMonsterUuid(uuid: string): MonsterRef | null {
  const text = uuid.trim();
  const comp = /^Compendium\.([^.]+)\.([^.]+)\.Actor\.([A-Za-z0-9]+)$/.exec(text);
  if (comp?.[1] && comp[2] && comp[3]) {
    return { kind: 'compendium', pack: `${comp[1]}.${comp[2]}`, id: comp[3] };
  }
  const world = /^Actor\.([A-Za-z0-9]+)$/.exec(text);
  if (world?.[1]) return { kind: 'world', id: world[1] };
  return null;
}

/** The part of a stat block both sides show. */
export interface StatBlock {
  name: string;
  size: string;
  creatureType: string;
  cr: number | null;
  ac: number | null;
  hp: number | null;
  speed: string;
  abilities: { key: string; value: number }[];
  /** Names of traits, actions and other features. The full text is read in Foundry. */
  features: string[];
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SIZES: Record<string, string> = {
  tiny: 'Tiny',
  sm: 'Small',
  med: 'Medium',
  lg: 'Large',
  huge: 'Huge',
  grg: 'Gargantuan',
};

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** "1/4" for a quarter and so on. */
export function formatCr(cr: number | null): string {
  if (cr === null) return '?';
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

/** A compendium entry from get-compendium-item (`fullData` holds the actor). */
export function statBlockFromCompendium(raw: unknown): StatBlock | null {
  const r = rec(raw);
  const data = rec(r['fullData']);
  const system = rec(data['system']);
  if (Object.keys(system).length === 0) return null;
  const attrs = rec(system['attributes']);
  const details = rec(system['details']);
  const ac = rec(attrs['ac']);
  const hp = rec(attrs['hp']);
  const speeds = rec(rec(attrs['movement'])['speeds']);
  const abilities = rec(system['abilities']);
  const items = Array.isArray(data['items']) ? data['items'] : [];
  return {
    name: str(data['name']) || str(r['name']),
    size: SIZES[str(rec(system['traits'])['size'])] ?? '',
    creatureType: str(rec(details['type'])['value']),
    cr: num(details['cr']),
    ac: num(ac['flat']) ?? num(ac['value']),
    hp: num(hp['max']) ?? num(hp['value']),
    speed: Object.entries(speeds)
      .filter(([, v]) => v !== null && v !== '' && v !== '0' && v !== 0)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(', '),
    abilities: ABILITY_KEYS.map(key => ({ key, value: num(rec(abilities[key])['value']) ?? 10 })),
    features: items.map(i => str(rec(i)['name'])).filter(Boolean),
  };
}

/** A world actor from get-character. */
export function statBlockFromActor(raw: unknown): StatBlock | null {
  const r = rec(raw);
  const stats = rec(r['stats']);
  if (Object.keys(stats).length === 0) return null;
  const hp = rec(stats['hitPoints']);
  const abilities = rec(stats['abilities']);
  const items = Array.isArray(r['items']) ? r['items'] : [];
  return {
    name: str(r['name']),
    size: SIZES[str(stats['size'])] ?? '',
    creatureType: str(stats['creatureType']),
    cr: num(stats['challengeRating']),
    ac: num(stats['armorClass']),
    hp: num(hp['max']),
    speed: '',
    abilities: ABILITY_KEYS.map(key => ({ key, value: num(rec(abilities[key])['value']) ?? 10 })),
    features: items.map(i => str(rec(i)['name'])).filter(Boolean),
  };
}
