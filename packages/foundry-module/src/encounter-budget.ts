/**
 * The party's XP budget for an encounter, shared by `suggest-balanced-encounter` and the play
 * recorder (which stamps the budgets on every `combat-start` record so the stats can later join
 * "planned" with "what the fight cost"). Uses dnd5e's 2024 `CONFIG.DND5E.ENCOUNTER_DIFFICULTY`
 * when present, else the 2014 DMG thresholds.
 */

type EncounterDifficulty = 'low' | 'moderate' | 'high';

/** 2014 DMG thresholds [easy, medium, hard, deadly] per character level. */
const DMG_2014: Record<number, number[]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1300, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],
  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],
  14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],
  18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900],
  20: [2800, 5700, 8500, 12700],
};

export function encounterBudget(
  table2024: unknown,
  levels: number[],
  difficulty: EncounterDifficulty
): { model: '2024' | '2014'; xpBudget: number } {
  let xpBudget = 0;
  if (Array.isArray(table2024)) {
    const col = { low: 0, moderate: 1, high: 2 }[difficulty];
    const table = table2024 as (number[] | undefined)[];
    for (const lvl of levels) {
      const row = table[lvl];
      if (Array.isArray(row)) xpBudget += row[col] ?? 0;
    }
    return { model: '2024', xpBudget };
  }
  const col = { low: 0, moderate: 1, high: 3 }[difficulty]; // high maps to deadly
  for (const lvl of levels) {
    const row = DMG_2014[Math.max(1, Math.min(20, lvl))];
    if (row) xpBudget += row[col] ?? 0;
  }
  return { model: '2014', xpBudget };
}

/** All three budgets at once (what the recorder stores on a combat start). */
export function encounterBudgets(
  table2024: unknown,
  levels: number[]
): Record<EncounterDifficulty, number> {
  return {
    low: encounterBudget(table2024, levels, 'low').xpBudget,
    moderate: encounterBudget(table2024, levels, 'moderate').xpBudget,
    high: encounterBudget(table2024, levels, 'high').xpBudget,
  };
}
