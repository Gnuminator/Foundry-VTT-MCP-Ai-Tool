// The live strip's words and small rules (item live-strip-component): numbered duplicate names, how
// a creature at 0 hit points reads, the pick bar's label and the condition plan, the End combat
// question, the Undo button's label. Pure; components/LiveStrip.tsx draws it and sends nothing from
// here.
import type { AiChange } from './changes';
import type { Combatant } from './combat';

/**
 * The names the strip shows, by combatant id: a name two or more creatures share gets a number in
 * the bridge's order ("Bandit 1", "Bandit 2"); a name that is alone stays as it is. Names the world
 * already numbered are unique and so unchanged.
 */
export function displayNames(combatants: readonly Combatant[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of combatants) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const c of combatants) {
    if ((counts.get(c.name) ?? 0) < 2) {
      names.set(c.id, c.name);
      continue;
    }
    const n = (seen.get(c.name) ?? 0) + 1;
    seen.set(c.name, n);
    names.set(c.id, `${c.name} ${n}`);
  }
  return names;
}

/** "dead" for a creature at 0 hit points, "down, death saves" for a player character; else null. */
export function downWords(c: Pick<Combatant, 'hp' | 'defeated' | 'isPC'>): string | null {
  if (c.hp.value > 0 && !c.defeated) return null;
  return c.isPC ? 'down, death saves' : 'dead';
}

/** The pick bar's line: "pick a creature" when nobody is picked, else who. */
export function pickText(names: readonly string[]): string {
  if (names.length === 0) return 'pick a creature';
  if (names.length <= 2) return names.join(' and ');
  return `${names.length} creatures`;
}

/** The conditions the chips offer, most used first (dnd5e's own names). */
export const CONDITIONS = [
  'prone',
  'poisoned',
  'frightened',
  'restrained',
  'stunned',
  'blinded',
  'charmed',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'unconscious',
] as const;

/** The plan-actor-change arguments that put a condition on the picked tokens (on, no duration). */
export function conditionArgs(targets: string[], condition: string): Record<string, unknown> {
  return { action: 'condition', targets, condition, active: true };
}

/** The End combat question: the scene in words, never an id. */
export function endQuestion(sceneName: string | null): string {
  const where = sceneName ? ` on ${sceneName}` : '';
  return `End the fight${where}? Undo stays in Recent Changes.`;
}

/** The newest change the GM can still undo: not an undo entry, not already undone. */
export function lastUndoable(changes: readonly AiChange[]): AiChange | null {
  return changes.find(c => c.mode !== 'undo' && !c.undoneBy && c.canUndo) ?? null;
}

/** "Undo: Wolf 2: 12 fire damage": the button's words, cut so the header does not grow. */
export function undoLabel(change: Pick<AiChange, 'summary'> | null): string {
  if (!change) return 'Nothing to undo';
  const text = change.summary.trim();
  const short = text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
  return short ? `Undo: ${short}` : 'Undo last change';
}
