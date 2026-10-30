// "Use Foundry targets" (item foundry-targets-picker): the tokens the GM has targeted in Foundry,
// or failing that selected on the canvas, fill the combat pick and the Tool runner's token fields
// (group save, roll request, Damage / Heal). Read through get-targets; nothing is written.
import { callTool } from './api';

export interface FoundryToken {
  tokenId: string;
  name: string;
  actorId: string | null;
}

export interface FoundryTargets {
  tokens: FoundryToken[];
  /** What the list is: the targeted tokens, else the selected ones. */
  source: 'targeted' | 'selected' | 'none';
}

const tokensOf = (v: unknown): FoundryToken[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((t: unknown) => {
    if (!t || typeof t !== 'object') return [];
    const r = t as Record<string, unknown>;
    if (typeof r['tokenId'] !== 'string' || typeof r['name'] !== 'string') return [];
    return [
      {
        tokenId: r['tokenId'],
        name: r['name'],
        actorId: typeof r['actorId'] === 'string' ? r['actorId'] : null,
      },
    ];
  });
};

/** Targets win over the selection: a GM who targeted tokens means those. */
export function readFoundryTargets(result: unknown): FoundryTargets {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const targeted = tokensOf(r['targets']);
  if (targeted.length > 0) return { tokens: targeted, source: 'targeted' };
  const selected = tokensOf(r['selected']);
  if (selected.length > 0) return { tokens: selected, source: 'selected' };
  return { tokens: [], source: 'none' };
}

export async function fetchFoundryTargets(): Promise<FoundryTargets> {
  return readFoundryTargets(await callTool('get-targets', {}));
}

/** One-line note after pressing the button. */
export function targetsNote(t: FoundryTargets): string {
  if (t.source === 'none') return 'Nothing is targeted or selected in Foundry.';
  const n = t.tokens.length;
  return `${n} ${t.source} in Foundry: ${t.tokens.map(x => x.name).join(', ')}`;
}

/** What a token field takes: names, ids, or actor ids, per the picker's annotation. */
export function targetValues(
  tokens: FoundryToken[],
  value: 'id' | 'name' | 'uuid' | undefined,
  kinds: readonly string[]
): string[] {
  if (value === 'name') return tokens.map(t => t.name);
  if (!kinds.includes('token') && kinds.includes('actor')) {
    return tokens.flatMap(t => (t.actorId ? [t.actorId] : []));
  }
  return tokens.map(t => t.tokenId);
}

/** Combat ids (the pick) of the combatants whose token is in the list. */
export function combatIdsFor(
  combatants: ReadonlyArray<{ id: string; tokenId: string | null }>,
  tokens: FoundryToken[]
): string[] {
  const ids = new Set(tokens.map(t => t.tokenId));
  return combatants.filter(c => c.tokenId !== null && ids.has(c.tokenId)).map(c => c.id);
}
