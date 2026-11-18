// Monster action buttons (item monster-action-buttons): up to four buttons for the one NPC picked
// on the live strip, read from the actor. The words and the tool arguments live here; nothing here
// sends. The component is components/MonsterActions.tsx.
import { weaponsOf, type Weapon } from './attack-form';

/** Most buttons shown for one creature. */
const MAX_ACTIONS = 4;

/** The localStorage key of the "apply damage without asking" switch. */
export const AUTO_APPLY_KEY = 'cogm_monster_autoapply';

/** The NPC's attacks from search-character-items: up to four, in the actor's own order. */
export function actionsOf(result: unknown): Weapon[] {
  return weaponsOf(result).slice(0, MAX_ACTIONS);
}

/** use-npc-activity arguments: the token runs the item; the AC of the target is read in Foundry. */
export function activityArgs(attackerToken: string, itemId: string): Record<string, unknown> {
  return { actor: attackerToken, itemName: itemId, isPublic: true };
}

interface ActivityResult {
  attackTotal: number | null;
  targetName: string | null;
  targetAC: number | null;
  hit: boolean | null;
  isCritical: boolean;
  damageTotal: number | null;
  damageByType: Array<{ type: string; total: number }>;
  item: string | null;
}

/** The use-npc-activity answer, read defensively; anything missing is null. */
export function readActivity(result: unknown): ActivityResult {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
  const byType = Array.isArray(r['damageByType'])
    ? r['damageByType'].flatMap((e: unknown) => {
        const x = (e ?? {}) as Record<string, unknown>;
        const total = num(x['total']);
        return typeof x['type'] === 'string' && total !== null && total > 0
          ? [{ type: x['type'], total }]
          : [];
      })
    : [];
  return {
    attackTotal: num(r['attackTotal']),
    targetName: typeof r['targetName'] === 'string' ? r['targetName'] : null,
    targetAC: num(r['targetAC']),
    hit: typeof r['hit'] === 'boolean' ? r['hit'] : null,
    isCritical: r['isCritical'] === true,
    damageTotal: num(r['damageTotal']),
    damageByType: byType,
    item: typeof r['item'] === 'string' ? r['item'] : null,
  };
}

/** "Scimitar: 17 vs AC 15 at Ilvara: hit, critical, 9 damage". */
export function resultLine(attacker: string, fallbackItem: string, a: ActivityResult): string {
  const item = a.item ?? fallbackItem;
  const roll = a.attackTotal === null ? 'rolled' : `${a.attackTotal}`;
  const ac = a.targetAC === null ? '' : ` vs AC ${a.targetAC}`;
  const at = a.targetName ? ` at ${a.targetName}` : '';
  const verdict = a.hit === null ? 'check the chat card' : a.hit ? 'hit' : 'miss';
  const crit = a.isCritical && a.hit !== false ? ', critical' : '';
  const dmg =
    a.hit !== false && a.damageTotal !== null && a.damageTotal > 0
      ? `, ${a.damageTotal} damage`
      : '';
  return `${attacker}, ${item}: ${roll}${ac}${at}: ${verdict}${crit}${dmg}`;
}

/** The damage a hit deals, one entry per type (untyped when the roll named none); none on a miss. */
export function damageParts(a: ActivityResult): Array<{ type: string | null; total: number }> {
  if (a.hit === false) return [];
  if (a.damageByType.length > 0) return a.damageByType;
  return a.damageTotal !== null && a.damageTotal > 0 ? [{ type: null, total: a.damageTotal }] : [];
}

/** plan-actor-change arguments for one damage part. */
export function applyArgs(
  targetToken: string,
  part: { type: string | null; total: number }
): Record<string, unknown> {
  return {
    action: 'damage',
    targets: [targetToken],
    amount: part.total,
    ...(part.type ? { damageType: part.type } : {}),
  };
}

/** The question the confirm window asks before damage goes in. */
export function applyQuestion(
  target: string,
  part: { type: string | null; total: number }
): string {
  return `Deal ${part.total} ${part.type ? `${part.type} ` : ''}damage to ${target}?`;
}

export const NO_TARGET_NOTE =
  'Target one creature in Foundry first (T on the map), then press the action.';
export const MANY_TARGETS_NOTE =
  'More than one creature is targeted. Target one: the roll is checked against one AC.';
export const NO_ACTIONS_NOTE = 'This creature has no weapon attacks on its sheet.';
