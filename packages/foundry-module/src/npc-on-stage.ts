/**
 * NPC on stage: the GM says "I speak as Hrafne now" and the Table TV (table-viewer-user.ts) shows
 * the portrait and, once the players know it, the name. One world setting carries it; the TV user's
 * client draws it. Only players-safe text is stored (see npc-on-stage-model.ts).
 */
import type { SetNpcOnStageReply, SetNpcOnStageRequest } from '@gnuminator/shared';
import { MODULE_ID } from './constants.js';
import {
  parseOnStage,
  safeImagePath,
  stageCaption,
  stageLabel,
  type NpcOnStage,
} from './npc-on-stage-model.js';
import { eventVisibilityFor } from './player-visibility.js';
import { isTableViewerUser } from './table-viewer-user.js';

const STAGE_SETTING = 'npcOnStage';
const STAGE_CLASS = 'fmb-npc-stage';

interface ActorLike {
  id?: string;
  name?: string;
  img?: string;
  hasPlayerOwner?: boolean;
}

/** Register the setting. Call from the module `init` hook, every client. */
export function registerNpcOnStageSettings(): void {
  game.settings.register(MODULE_ID, STAGE_SETTING, {
    name: 'NPC on stage',
    hint: 'The NPC the GM speaks as now; the Table TV shows the portrait and, once the players know it, the name.',
    scope: 'world',
    config: false,
    type: Object,
    default: {},
    onChange: () => renderStage(),
  });
}

function readStage(): NpcOnStage | null {
  try {
    return parseOnStage(game.settings.get(MODULE_ID, STAGE_SETTING));
  } catch {
    return null;
  }
}

/** Draw (or remove) the overlay. Acts for the Table user only. */
function renderStage(): void {
  if (typeof document === 'undefined') return;
  if (!isTableViewerUser(game.user)) return;
  document.querySelector(`.${STAGE_CLASS}`)?.remove();
  const stage = readStage();
  if (!stage) return;
  const el = document.createElement('div');
  el.className = STAGE_CLASS;
  if (stage.img) {
    const img = document.createElement('img');
    img.className = `${STAGE_CLASS}-img`;
    img.src = stage.img;
    img.alt = '';
    el.appendChild(img);
  }
  const name = document.createElement('div');
  name.className = `${STAGE_CLASS}-name`;
  name.textContent = stageCaption(stage);
  el.appendChild(name);
  document.body.appendChild(el);
}

/** Show what is on stage at load. Call at `ready`, every client (it acts for the TV user only). */
export function startNpcOnStage(): void {
  renderStage();
}

function findActor(data: SetNpcOnStageRequest): ActorLike | null {
  const actors = game.actors as unknown as {
    get(id: string): ActorLike | undefined;
    contents?: ActorLike[];
  };
  if (data.actorId) return actors.get(data.actorId) ?? null;
  const wanted = data.actorName?.trim().toLowerCase();
  if (!wanted) return null;
  const matches = (actors.contents ?? []).filter(a => a.name?.trim().toLowerCase() === wanted);
  if (matches.length > 1) {
    throw new Error(`More than one actor is named "${data.actorName}"; use actorId.`);
  }
  return matches[0] ?? null;
}

/** The bridge handler: put an NPC on stage or take it off. GM only (the caller has the GM gate). */
export async function setNpcOnStage(data: SetNpcOnStageRequest): Promise<SetNpcOnStageReply> {
  const previous = readStage();
  const prev = previous ? { actorId: previous.actorId } : null;
  if (data?.clear === true) {
    await game.settings.set(MODULE_ID, STAGE_SETTING, {});
    return { success: true, onStage: null, previous: prev };
  }
  const actor = findActor(data ?? {});
  if (!actor?.id || typeof actor.name !== 'string') {
    throw new Error('Actor not found: give actorId or actorName.');
  }
  if (actor.hasPlayerOwner === true) {
    throw new Error(`${actor.name} is a player character; only NPCs go on stage.`);
  }
  const playerName = eventVisibilityFor(actor).playerName;
  const label = stageLabel(actor.name, playerName, data.nameKnown === true);
  const stage: NpcOnStage = {
    actorId: actor.id,
    label,
    img: safeImagePath(actor.img),
    at: Date.now(),
  };
  await game.settings.set(MODULE_ID, STAGE_SETTING, stage);
  return {
    success: true,
    onStage: { actorId: actor.id, name: actor.name, nameShown: label !== null },
    previous: prev,
  };
}
