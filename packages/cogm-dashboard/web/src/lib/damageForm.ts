// The simple Damage / Heal form on the combat strip (item damage-form-simple): the damage type
// chips, the plan-actor-change arguments and the words on the button. Nothing here sends.

/** Most used first (the order of the chips). `none` is untyped damage. */
export const DAMAGE_TYPES = [
  'slashing',
  'piercing',
  'bludgeoning',
  'fire',
  'cold',
  'lightning',
  'poison',
  'necrotic',
  'radiant',
  'psychic',
  'force',
  'thunder',
  'acid',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number] | 'none';
export type DamageMode = 'damage' | 'healing';

export interface DamageDraft {
  mode: DamageMode;
  /** The field as typed; digits only. */
  amount: string;
  type: DamageType;
}

export const EMPTY_DRAFT: DamageDraft = { mode: 'damage', amount: '', type: 'none' };

/** The amount as a number, or null when the field is empty or zero. */
export function amountOf(draft: DamageDraft): number | null {
  const n = draft.amount.trim() === '' ? NaN : Number(draft.amount);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The plan-actor-change arguments, or null while there is no amount or nobody picked. */
export function damageArgs(draft: DamageDraft, targets: string[]): Record<string, unknown> | null {
  const amount = amountOf(draft);
  if (amount === null || targets.length === 0) return null;
  return {
    action: draft.mode,
    targets,
    amount,
    ...(draft.mode === 'damage' && draft.type !== 'none' ? { damageType: draft.type } : {}),
  };
}

function names(targets: string[]): string {
  if (targets.length <= 2) return targets.join(' and ');
  return `${targets.length} tokens`;
}

/** "Deal 8 fire damage to Wolf 2 and Wolf 3 in Foundry", "Heal Ilvara for 5 in Foundry". */
export function applyLabel(draft: DamageDraft, targets: string[]): string {
  const amount = amountOf(draft);
  const who = names(targets);
  if (draft.mode === 'healing') return `Heal ${who} for ${amount ?? '…'} in Foundry`;
  const kind = draft.type === 'none' ? '' : `${draft.type} `;
  return `Deal ${amount ?? '…'} ${kind}damage to ${who} in Foundry`;
}
