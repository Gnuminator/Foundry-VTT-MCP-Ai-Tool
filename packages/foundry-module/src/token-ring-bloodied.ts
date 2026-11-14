/**
 * Bloodied token rings (I-093).
 *
 * dnd5e 6 already flashes a dynamic token ring on damage and healing, turns it black when the
 * token is defeated and gives the turn holder the gradient effect. It has no ring look for a
 * bloodied creature, so a token at or below half hit points looked like a healthy one at a
 * glance, on the TV and on a phone. This wraps `getRingColors` on the token document class so a
 * token whose actor carries the dnd5e `bloodied` status shows a red ring. Defeated still wins
 * (dnd5e's own black ring), and the ring goes back when the status goes away.
 */
export const BLOODIED_RING_COLOR = 0xff1a1a;
const BLOODIED_STATUS = 'bloodied';

interface RingColors {
  ring?: number;
  background?: number;
}

interface RingTokenDocument {
  actor?: { statuses?: { has: (id: string) => boolean } } | null;
  object?: { renderFlags?: { set: (flags: Record<string, boolean>) => void } } | null;
}

type GetRingColors = (this: RingTokenDocument) => RingColors;

const WRAPPED = Symbol.for('foundry-mcp-bridge.bloodied-ring');

/** The ring colours with the bloodied red added, unless the base colours already force one. */
export function withBloodiedColor(base: RingColors, bloodied: boolean): RingColors {
  if (!bloodied || base.ring !== undefined) return base;
  return { ...base, ring: BLOODIED_RING_COLOR };
}

/** Wrap getRingColors on the token document class. Returns false when there is nothing to wrap. */
export function installBloodiedRing(): boolean {
  const docClass = (
    CONFIG as { Token?: { documentClass?: { prototype?: Record<string | symbol, unknown> } } }
  ).Token?.documentClass;
  const proto = docClass?.prototype;
  const original = proto?.getRingColors;
  if (!proto || typeof original !== 'function') return false;
  if (proto[WRAPPED]) return true;
  proto.getRingColors = function (this: RingTokenDocument): RingColors {
    const base = (original as GetRingColors).call(this) ?? {};
    return withBloodiedColor(base, this.actor?.statuses?.has(BLOODIED_STATUS) === true);
  };
  proto[WRAPPED] = true;
  return true;
}

/** Redraw the ring of every token of the actor an effect belongs to (status added or removed). */
export function refreshRingsOfEffect(effect: {
  parent?: { getActiveTokens?: () => RingTokenDocument['object'][] } | null;
  statuses?: Iterable<string>;
}): void {
  if (!effect.statuses || ![...effect.statuses].includes(BLOODIED_STATUS)) return;
  for (const token of effect.parent?.getActiveTokens?.() ?? [])
    token?.renderFlags?.set({ refreshRingVisuals: true });
}
