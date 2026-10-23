// Start combat (David's GM test): the tokens the picker lists and which of them are ticked at the
// start. The rule is the module's (combat-plan.ts, no tokenIds): player characters and Hostile
// tokens fight, Neutral and Friendly ones stay out until the GM ticks them. get-token-positions
// gives the side as `category` (pc, enemy for Hostile, npc for the rest).
import { SIDE_LABEL, type Side } from './combat';

/** One token of the viewed scene as get-token-positions lists it (the fields the picker reads). */
export interface SceneToken {
  tokenId: string;
  name: string;
  actorId: string | null;
  category: Side;
  hidden: boolean;
}

/** The answer of get-token-positions, as far as the picker reads it. */
export interface TokenPositionsAnswer {
  sceneName?: string;
  tokens?: SceneToken[];
}

const ORDER: Record<Side, number> = { pc: 0, enemy: 1, npc: 2 };

/** The tokens in the picker's order: player characters, then Hostile, then the rest; by name. */
export function pickerRows(tokens: readonly SceneToken[] | undefined): SceneToken[] {
  return [...(tokens ?? [])].sort(
    (a, b) => ORDER[a.category] - ORDER[b.category] || a.name.localeCompare(b.name)
  );
}

/** A token with no actor cannot be a combatant. */
export function canFight(token: SceneToken): boolean {
  return token.actorId !== null && token.actorId !== '';
}

/** The ids ticked at the start: player characters and Hostile tokens that can fight. */
export function defaultTicks(rows: readonly SceneToken[]): Set<string> {
  return new Set(rows.filter(t => canFight(t) && t.category !== 'npc').map(t => t.tokenId));
}

/** What a row says about its side: Hostile is the Foundry word for the enemies. */
export function sideWords(token: SceneToken): string {
  if (token.category === 'enemy') return 'Hostile';
  return token.category === 'pc' ? SIDE_LABEL.pc : 'Neutral or Friendly';
}

/** The plan request for the ticked tokens, in the picker's order. */
export function startArgs(
  rows: readonly SceneToken[],
  ticked: ReadonlySet<string>
): { action: 'start'; tokenIds: string[] } {
  return {
    action: 'start',
    tokenIds: rows.filter(t => ticked.has(t.tokenId) && canFight(t)).map(t => t.tokenId),
  };
}
