// NPC on stage (the strip's chip): the words and the argument shapes for `set-npc-on-stage`.

/** What the tool answers (GM side: includes the true name). */
export interface StageReply {
  onStage: { actorId: string; name: string; nameShown: boolean } | null;
}

export interface StagePick {
  /** An actor id from the picker, or a name from a combat card. */
  actorId?: string;
  actorName?: string;
}

/** The tool arguments to put an NPC on stage. */
export function stageArgs(pick: StagePick, nameKnown: boolean): Record<string, unknown> {
  return {
    ...(pick.actorId ? { actorId: pick.actorId } : { actorName: pick.actorName ?? '' }),
    ...(nameKnown ? { nameKnown: true } : {}),
  };
}

/** The tool arguments to take the NPC off the TV. */
export const STAGE_CLEAR_ARGS = { clear: true } as const;

/** What the chip says about the NPC on stage. */
export function stageStatus(reply: StageReply | null): string {
  if (!reply?.onStage) return 'Nobody on stage.';
  const { name, nameShown } = reply.onStage;
  return nameShown
    ? `Speaking as ${name}. The TV shows the name.`
    : `Speaking as ${name}. The TV shows a "?" until the players know the name.`;
}

/** The NPC names of the fight (not the party, no repeats), as chips to put on stage in one tap. */
export function combatNpcNames(
  combatants: readonly { name: string; isPC: boolean; defeated: boolean }[]
): string[] {
  const seen = new Set<string>();
  for (const c of combatants) {
    if (!c.isPC && !c.defeated) seen.add(c.name);
  }
  return [...seen];
}
