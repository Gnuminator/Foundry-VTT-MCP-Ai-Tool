// Quick roll requests (item quick-roll-buttons): the choices behind the one-click "ask for a roll"
// bar on the Party card and the combat strip, and the request-player-rolls arguments they make.
// Nothing here talks to the bridge; components/QuickRoll.tsx sends. The ids are the names the
// module's roll path resolves (data-access/player-rolls.ts getSkillCode).

export type RollKind = 'check' | 'save' | 'skill';

export const ABILITIES = [
  { id: 'str', label: 'Strength' },
  { id: 'dex', label: 'Dexterity' },
  { id: 'con', label: 'Constitution' },
  { id: 'int', label: 'Intelligence' },
  { id: 'wis', label: 'Wisdom' },
  { id: 'cha', label: 'Charisma' },
] as const;

export const SKILLS = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival',
] as const;

export type Advantage = 'normal' | 'advantage' | 'disadvantage';

/** What the bar has picked. `what` is "<kind>:<id>", the one select's value. */
export interface RollPick {
  what: string;
  dc: string;
  isPublic: boolean;
  advantage: Advantage;
}

export const DEFAULT_PICK: RollPick = {
  what: 'skill:Perception',
  dc: '',
  isPublic: false,
  advantage: 'normal',
};

/** The select's options, grouped: checks, saves, skills. */
export function rollOptions(): { group: string; options: { value: string; label: string }[] }[] {
  return [
    {
      group: 'Ability check',
      options: ABILITIES.map(a => ({ value: `check:${a.id}`, label: `${a.label} check` })),
    },
    {
      group: 'Saving throw',
      options: ABILITIES.map(a => ({ value: `save:${a.id}`, label: `${a.label} save` })),
    },
    {
      group: 'Skill check',
      options: SKILLS.map(s => ({ value: `skill:${s}`, label: s })),
    },
  ];
}

const KNOWN = new Set(rollOptions().flatMap(g => g.options.map(o => o.value)));

/** A remembered pick, repaired: anything unknown falls back to the default. */
export function cleanPick(raw: unknown): RollPick {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RollPick>;
  const dc = typeof r.dc === 'string' && /^\d{0,2}$/.test(r.dc) ? r.dc : '';
  return {
    what: typeof r.what === 'string' && KNOWN.has(r.what) ? r.what : DEFAULT_PICK.what,
    dc,
    isPublic: r.isPublic === true,
    advantage:
      r.advantage === 'advantage' || r.advantage === 'disadvantage' ? r.advantage : 'normal',
  };
}

/** The label of a pick for the button and the toast: "Dexterity save", "Perception". */
export function pickLabel(pick: RollPick): string {
  for (const g of rollOptions()) {
    const o = g.options.find(x => x.value === pick.what);
    if (o) return o.label;
  }
  return pick.what;
}

/** The request-player-rolls arguments for one character. */
export function rollArgs(pick: RollPick, target: string): Record<string, unknown> {
  const sep = pick.what.indexOf(':');
  const kind = pick.what.slice(0, sep);
  const id = pick.what.slice(sep + 1);
  const dc = pick.dc.trim() === '' ? NaN : Number(pick.dc);
  return {
    rollType: kind === 'check' ? 'ability' : kind,
    rollTarget: kind === 'skill' ? id.toLowerCase() : id,
    targetPlayer: target,
    isPublic: pick.isPublic,
    userConfirmedVisibility: true,
    // The card says the DC out loud, as request-ability-check does.
    ...(Number.isInteger(dc) && dc > 0 ? { dc, flavor: `DC ${dc}` } : {}),
    ...(pick.advantage === 'normal' ? {} : { advantage: pick.advantage }),
  };
}

/** One line for the toast once every request has answered. */
export function sentSummary(
  pick: RollPick,
  ok: string[],
  failed: { name: string; error: string }[]
): string {
  const what = `${pickLabel(pick)}${pick.dc.trim() ? ` DC ${pick.dc.trim()}` : ''}`;
  const who = ok.length === 1 ? ok[0] : `${ok.length} characters`;
  if (failed.length === 0) return `✓ Asked ${who} for ${what}`;
  const bad = failed.map(f => `${f.name}: ${f.error}`).join('; ');
  return ok.length === 0
    ? `✗ ${what} not sent. ${bad}`
    : `✓ Asked ${who} for ${what}. Not sent: ${bad}`;
}
