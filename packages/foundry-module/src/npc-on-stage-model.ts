/**
 * NPC on stage: what the Table TV shows while the GM speaks as an NPC. Pure, no Foundry globals.
 *
 * The world setting holds only what the players may see: the portrait path and a label, which is
 * null while the players do not know the NPC's name. The true name never goes into it.
 */

/** What the world setting stores and the TV draws. */
export interface NpcOnStage {
  actorId: string;
  /** The name the players know, or null while they do not (the TV then shows "?"). */
  label: string | null;
  img: string | null;
  /** When the GM put the NPC on stage (ms since epoch). */
  at: number;
}

/** The text on the TV when the players do not know the name yet. */
const UNKNOWN_NPC_LABEL = '?';

const MAX_LABEL = 80;
const MAX_IMG = 500;

/** A picture path the TV may load: a file in the world or a web address, never a script or data URL. */
export function safeImagePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path === '' || path.length > MAX_IMG) return null;
  if (/^(?:javascript|data|vbscript|file):/i.test(path)) return null;
  for (const ch of path) {
    if (ch.charCodeAt(0) < 0x20 || '"\'<>'.includes(ch)) return null;
  }
  return path;
}

/**
 * The label the players may see: the true name when the GM said they know it or the players
 * already see it on a token, else null.
 */
export function stageLabel(
  trueName: string,
  playerName: string | null,
  nameKnown: boolean
): string | null {
  const name = trueName.trim();
  if (name === '') return null;
  if (!nameKnown && playerName === null) return null;
  return name.slice(0, MAX_LABEL);
}

/** Read the stored setting; anything that is not a well-formed entry means nobody is on stage. */
export function parseOnStage(raw: unknown): NpcOnStage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.actorId !== 'string' || r.actorId === '') return null;
  const label =
    typeof r.label === 'string' && r.label.trim() !== '' ? r.label.slice(0, MAX_LABEL) : null;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  return { actorId: r.actorId, label, img: safeImagePath(r.img), at };
}

/** The text shown under the portrait. */
export function stageCaption(stage: NpcOnStage): string {
  return stage.label ?? UNKNOWN_NPC_LABEL;
}
