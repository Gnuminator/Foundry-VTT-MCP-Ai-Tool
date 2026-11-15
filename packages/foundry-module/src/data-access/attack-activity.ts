/** A dnd5e attack activity: the roll the dashboard's Attack asks for. */
export interface AttackActivity {
  type?: string;
  /** Activity#use: the card and its consumption belong to this activity, not the item's first. */
  use: (...args: unknown[]) => Promise<unknown>;
  rollAttack: (config: object, dialog: object, message: object) => Promise<unknown>;
  /** dnd5e 6: the item can be used and is not hidden (`item.canUse && !isHidden`); false is not only "no uses left". */
  canUse?: boolean;
}

/** The first usable attack activity of a dnd5e item (a weapon or a spell), if it has one. */
export function findAttackActivity(item: Item): AttackActivity | undefined {
  const activities = (item.system as { activities?: Iterable<AttackActivity> } | undefined)
    ?.activities;
  if (!activities) return undefined;
  return Array.from(activities).find(
    a =>
      a.type === 'attack' &&
      a.canUse !== false &&
      typeof a.rollAttack === 'function' &&
      typeof a.use === 'function'
  );
}
