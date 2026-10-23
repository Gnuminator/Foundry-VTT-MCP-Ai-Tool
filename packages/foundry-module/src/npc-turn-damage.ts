/**
 * NPC turn assistant, damage from rolls (part 3): `results` holds what the rolls dealt, and the
 * plan turns it into hit point changes next to the move, so one confirm covers the turn and one
 * undo puts it back. The rolls themselves happen first (a roll cannot be undone); nothing here
 * rolls. Damage goes through dnd5e's own `applyDamage` (a dry run, as `plan-actor-change` does),
 * so resistance, immunity and temp hit points count.
 */
import type { GuardedOp, NpcTurnPlan } from '@gnuminator/shared';

import {
  changedOnly,
  damageTypeLabel,
  dryRunDamage,
  hpAfter,
  hpOf,
  hpText,
  resolveTargets,
} from './live-plan.js';
import { planNpcTurn } from './npc-turn.js';

type Rec = Record<string, unknown>;

interface Hit {
  tokenId: string;
  name: string;
  damages: Array<{ value: number; type: string }>;
  /** Readable pieces for the step line. */
  parts: string[];
}

/** `planNpcTurn`, then the hit point changes of `results` added to the same ops. */
export async function planNpcTurnWithDamage(data: unknown): Promise<NpcTurnPlan> {
  const plan = planNpcTurn(data);
  const results = (data as Rec | null)?.results;
  if (results === undefined) return plan;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(
      'results needs at least one entry: the target and the damage the roll reported'
    );
  }
  const hits = new Map<string, Hit>();
  for (const raw of results) {
    const entry = (raw !== null && typeof raw === 'object' ? raw : {}) as Rec;
    const asked = typeof entry.target === 'string' ? entry.target.trim() : '';
    const target = plan.context.targets.find(
      t => t.tokenId === asked || t.name.toLowerCase() === asked.toLowerCase()
    );
    if (!target) {
      const names = plan.context.targets.map(t => t.name).join(', ') || 'none';
      throw new Error(`"${asked}" is not a target in this fight (targets: ${names})`);
    }
    const amount = entry.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Damage to ${target.name} needs an amount of 0 or more`);
    }
    const multiplier = entry.multiplier === undefined ? 1 : entry.multiplier;
    if (typeof multiplier !== 'number' || !(multiplier >= 0 && multiplier <= 1)) {
      throw new Error(
        `Damage to ${target.name}: multiplier must be between 0 and 1 (0.5 for half damage on a save; a critical hit's dice are already doubled)`
      );
    }
    const type = typeof entry.damageType === 'string' ? entry.damageType.trim() : '';
    const value = Math.floor(amount * multiplier);
    const hit = hits.get(target.tokenId) ?? {
      tokenId: target.tokenId,
      name: target.name,
      damages: [],
      parts: [],
    };
    hits.set(target.tokenId, hit);
    const label = `${value}${damageTypeLabel(type || undefined)}`;
    hit.parts.push(multiplier === 1 ? label : `${label} (x${multiplier} of ${amount})`);
    if (value > 0) hit.damages.push({ value, type });
  }

  const ops: GuardedOp[] = [...(plan.ops ?? [])];
  const damageOps: GuardedOp[] = [];
  const lines: string[] = [];
  const hurt: string[] = [];
  for (const hit of hits.values()) {
    const { actor } = resolveTargets([hit.tokenId])[0] ?? {};
    if (!actor) throw new Error(`${hit.name} has no actor to damage`);
    const before = hpOf(actor);
    if (!before) {
      lines.push(`${hit.name}: has no hit points`);
      continue;
    }
    if (hit.damages.length === 0) {
      lines.push(`${hit.name}: ${hit.parts.join(' + ')} damage, no change`);
      continue;
    }
    const result = await dryRunDamage(actor, hit.damages, {});
    if (!result) {
      lines.push(`${hit.name}: dnd5e or another module cancelled the damage`);
      continue;
    }
    const changes = changedOnly(actor, result.updates);
    if (Object.keys(changes).length === 0) {
      lines.push(`${hit.name}: ${hit.parts.join(' + ')} damage, no change`);
      continue;
    }
    damageOps.push({ kind: 'update', uuid: actor.uuid, changes });
    hurt.push(hit.name);
    lines.push(
      `${hit.name}: ${hit.parts.join(' + ')} damage, ${Math.max(result.amount, 0)} taken, ${hpText(before, hpAfter(actor, changes))}`
    );
  }
  if (damageOps.length === 0 && ops.length === 0) {
    throw new Error(`Nothing to change: ${lines.join('; ')}`);
  }
  ops.push(...damageOps);
  const base = plan.summary ?? `NPC turn: ${plan.context.token.name}`;
  const summary = hurt.length > 0 ? `${base}, damage to ${hurt.join(', ')}` : base;
  return { ...plan, summary, ops, steps: [...plan.steps, ...lines] };
}
