// Monster action buttons (item monster-action-buttons): up to four buttons for the one NPC picked
// on the live strip, read from the actor. The words and the tool arguments live here; nothing here
// sends. The component is components/MonsterActions.tsx.
import { weaponsOf, type Weapon } from './attack-form';
import type { GuardedOutcome, GuardedTools } from './guarded';

/** Most buttons shown for one creature. */
const MAX_ACTIONS = 4;

/** The NPC's attacks from search-character-items: up to four, in the actor's own order. */
export function actionsOf(result: unknown): Weapon[] {
  return weaponsOf(result).slice(0, MAX_ACTIONS);
}

/**
 * use-npc-activity arguments: the token runs the item; the AC of the target is read in Foundry.
 * The roll is public on purpose: the table sees a monster attack as it would at a real table.
 */
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
  const verdict = landed(a) ? 'hit' : a.hit === null ? 'check the chat card' : 'miss';
  const crit = a.isCritical ? ', critical' : '';
  const dmg =
    (landed(a) || a.hit === null) && a.damageTotal !== null && a.damageTotal > 0
      ? `, ${a.damageTotal} damage`
      : '';
  return `${attacker}, ${item}: ${roll}${ac}${at}: ${verdict}${crit}${dmg}`;
}

/** The attack is known to have landed: a hit, or a critical (a natural 20 hits whatever the AC). */
export function landed(a: ActivityResult): boolean {
  return a.hit === true || a.isCritical;
}

interface DamagePart {
  type: string | null;
  total: number;
}

/**
 * The damage the roll made, one entry per type (untyped when the roll named none); none on a known
 * miss. With an unknown verdict (`hit` null, no critical) the damage is still listed so the GM can
 * apply it behind the confirm; the caller never skips that confirm then.
 */
export function damageParts(a: ActivityResult): DamagePart[] {
  if (!landed(a) && a.hit === false) return [];
  if (a.damageByType.length > 0) return a.damageByType;
  return a.damageTotal !== null && a.damageTotal > 0 ? [{ type: null, total: a.damageTotal }] : [];
}

/**
 * Puts the damage on the target, one plan per damage type. The first plan asks once for all parts
 * ("Deal 7 piercing and 5 poison damage to X?"; a cancel there changes nothing); the next ones
 * apply at once, that question covering them. `canSkip` lets the module's "apply without
 * confirming" switch skip the question, and is false while the verdict is unknown.
 */
export async function applyParts(
  plan: GuardedTools['plan'],
  target: { tokenId: string; name: string },
  parts: DamagePart[],
  canSkip: boolean
): Promise<{ applied: number; last: GuardedOutcome | null }> {
  let applied = 0;
  let last: GuardedOutcome | null = null;
  for (const part of parts) {
    last = await plan(
      'plan-actor-change',
      applyArgs(target.tokenId, part),
      applied === 0
        ? {
            confirmLine: {
              title: 'Apply damage',
              question: applyQuestion(target.name, parts, !canSkip),
              confirmLabel: 'Apply damage',
            },
            // The module's "apply without confirming" switch for live play skips the question.
            skipConfirmWhenAutoApply: canSkip,
            label: 'Apply damage',
          }
        : { label: 'Apply damage' }
    );
    if (last.status !== 'done') break;
    applied += 1;
  }
  return { applied, last };
}

/** What went in, said from the parts that applied: "7 piercing applied; 5 poison not applied". */
export function appliedLine(parts: DamagePart[], applied: number, mayHaveApplied: boolean): string {
  const word = (p: DamagePart): string => `${p.total}${p.type ? ` ${p.type}` : ''}`;
  const done = parts.slice(0, applied).map(word);
  const rest = parts.slice(applied).map(word);
  if (rest.length === 0) return '';
  const left = mayHaveApplied
    ? `${rest.join(' and ')} may have applied (check Recent Changes)`
    : `${rest.join(' and ')} not applied`;
  return done.length > 0 ? `${done.join(' and ')} applied; ${left}` : `Damage not applied: ${left}`;
}

/** plan-actor-change arguments for one damage part. */
function applyArgs(targetToken: string, part: DamagePart): Record<string, unknown> {
  return {
    action: 'damage',
    targets: [targetToken],
    amount: part.total,
    ...(part.type ? { damageType: part.type } : {}),
  };
}

/** The question the confirm window asks before damage goes in. */
function applyQuestion(target: string, parts: DamagePart[], unknownHit: boolean): string {
  const list = parts.map(p => `${p.total}${p.type ? ` ${p.type}` : ''}`).join(' and ');
  const ask = `Deal ${list} damage to ${target}?`;
  return unknownHit ? `Hit not confirmed (check the chat card). ${ask}` : ask;
}

export const NO_TARGET_NOTE =
  'Target one creature in Foundry first (T on the map), then press the action.';
export const MANY_TARGETS_NOTE =
  'More than one creature is targeted. Target one: the roll is checked against one AC.';
export const NO_ACTIONS_NOTE = 'This creature has no weapon attacks on its sheet.';
