// GET /api/party-sheets for the After a paper night stories: the lantern crew's sheets as the form
// reads them (the part of the character sheet it uses), and a plan-paper-sync answer.
const sheet = (i: number): Record<string, unknown> => {
  const caster = i % 2 === 0;
  const name = ['Aldric', 'Brenna', 'Cormac', 'Delphine'][i] ?? `Crew member ${i + 1}`;
  return {
    id: `a${i + 1}`,
    name,
    player: ['Mika', 'Jon', 'Sam', 'Lee'][i] ?? 'Player',
    classes: [{ name: caster ? 'Cleric' : 'Fighter', levels: 3, hitDie: caster ? 'd8' : 'd10' }],
    hp: { value: 20 - i * 3, max: 24 + i * 2, temp: i === 1 ? 4 : 0 },
    hitDice: { value: 2, max: 3 },
    exhaustion: i === 1 ? 1 : 0,
    inspiration: i === 0,
    deathSaves: { success: 0, failure: 0 },
    conditions: i === 2 ? ['Poisoned'] : [],
    slots: caster
      ? [
          { level: 1, value: 3, max: 4, pact: false },
          { level: 2, value: 2, max: 2, pact: false },
        ]
      : [],
    features: [
      {
        id: `f${i}`,
        name: caster ? 'Channel Divinity' : 'Second Wind',
        uses: { value: 1, max: 1 },
      },
    ],
    inventory: [
      { id: `i${i}a`, name: 'Rope (50 ft)', quantity: 1, uses: null },
      { id: `i${i}b`, name: 'Potion of Healing', quantity: 2, uses: null },
    ],
    currency: { pp: 0, gp: 112 - i * 10, ep: 0, sp: 4, cp: 0 },
  };
};

export const paperSheets = (count: number, unreadable: string[] = []): unknown => ({
  sheets: Array.from({ length: count }, (_, i) => sheet(i)),
  unreadable,
});

export const PAPER_SHEETS = paperSheets(2);
export const PAPER_SHEETS_FOUR = paperSheets(4);
export const PAPER_SHEETS_UNREADABLE = paperSheets(2, ['Sam']);
export const PAPER_SHEETS_EMPTY: unknown = { sheets: [], unreadable: [] };

/** A plan the bridge makes for an edit of Aldric's sheet. */
export const PAPER_PLAN: unknown = {
  planId: 'plan-paper-1',
  risk: 'write',
  summary: 'Paper sync for Aldric: HP 20 to 12, gp 112 to 87',
  actor: { name: 'Aldric', uuid: 'Actor.a1' },
  changes: [
    { field: 'hp', label: 'HP', before: 20, after: 12, line: 'HP 20 to 12 of 24' },
    { field: 'coins', label: 'gp', before: 112, after: 87, line: 'gp 112 to 87' },
  ],
  unchanged: [],
  warnings: [],
  autoApply: false,
};

export const PAPER_PLAN_REMOVES: unknown = {
  ...(PAPER_PLAN as Record<string, unknown>),
  risk: 'destructive',
  summary: 'Paper sync for Aldric: Rope (50 ft) removed',
  changes: [
    {
      field: 'inventory',
      label: 'Rope (50 ft)',
      before: 1,
      after: 0,
      line: 'Rope (50 ft) removed',
    },
  ],
};
