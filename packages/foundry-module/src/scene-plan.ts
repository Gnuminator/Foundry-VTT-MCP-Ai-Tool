/**
 * Scene dressing plans (I-112): the module's read-only `planSceneChange` query
 * turns one `plan-scene-change` request into guarded ops, so templates, darkness,
 * map notes and loot show in Recent Changes with Undo like damage and conditions
 * do. Nothing is written here; the bridge stores the ops as a plan and
 * `apply-planned-change` runs them.
 *
 * - template: one `create` of a MeasuredTemplate (Foundry 13) or a flagged Region
 *   (Foundry 14, `systems/regions.ts`) on the viewed scene; the tokens inside the
 *   area are worked out now and returned beside the plan.
 * - clear-templates: one `delete` per template (`all` only ever takes this tool's
 *   flagged Regions on Foundry 14, never a hand-made GM region).
 * - mood: one `update` of the scene's `environment.*` darkness and global light.
 * - note, remove-note: a `create` / `delete` of a map pin (Note).
 * - loot: an `update` of the actor's currency to absolute new values, a `create`
 *   per item (resolved by UUID, bad UUIDs are listed and skipped) and a chat card.
 *
 * The wire contract is `shared/src/scene-change.ts`; only its types are imported
 * (the browser cannot resolve `@gnuminator/shared` at runtime). The query name is
 * mirrored here and pinned by `scene-plan.test.ts`.
 */
import type {
  GuardedOp,
  SceneChangePlan,
  SceneChangeRequest,
  SceneClearTemplatesRequest,
  SceneLootRequest,
  SceneMoodRequest,
  SceneNoteRequest,
  SceneRemoveNoteRequest,
  SceneTemplateRequest,
} from '@gnuminator/shared';

import * as shared from './data-access/shared.js';
import {
  findToken,
  requireCurrentScene,
  templateDocumentType,
  tokenCenter,
  tokensInTemplate,
  type SceneDoc,
  type TemplateGeometry,
} from './scene-plan-geometry.js';
import { currentLevelId, sceneHasLevels } from './systems/core.js';
import {
  buildTemplateRegionData,
  isToolTemplateRegion,
  type TemplateParams,
} from './systems/regions.js';

/** Query name (mirror of the shared `SCENE_PLAN_QUERY`). */
export const SCENE_PLAN_QUERY = 'planSceneChange';

/** The dnd5e currencies loot can add. */
const CURRENCIES = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

/** The contents of a Foundry collection (or a plain array) as an array. */
function contentsOf(collection: SceneDoc): SceneDoc[] {
  return collection?.contents ?? collection ?? [];
}

/** The uuid of an embedded document of `scene` (Foundry builds it as `<parent>.<Type>.<id>`). */
function embeddedUuid(scene: SceneDoc, documentName: string, id: string): string {
  return `${String(scene.uuid)}.${documentName}.${id}`;
}

function rec(value: unknown): { action?: unknown } | null {
  return value !== null && typeof value === 'object' ? value : null;
}

/** The value when it is a non-empty string, else undefined (so `??` can pick a default). */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function quoted(name: unknown): string {
  return `"${typeof name === 'string' ? name : ''}"`;
}

// ---------------------------------------------------------------------------
// Measured templates
// ---------------------------------------------------------------------------

/**
 * The acting user's colour as a CSS string. Foundry 14's `User#color` is a Color
 * object (use its `css`); Foundry 13 stores a plain string.
 */
function userColor(): string | undefined {
  const color = (game.user as { color?: unknown } | undefined)?.color;
  const css =
    color !== null && typeof color === 'object' ? (color as { css?: unknown }).css : undefined;
  return nonEmpty(css) ?? nonEmpty(color);
}

/**
 * Plan an AoE template on the viewed scene. Origin is explicit `x`/`y` pixels, or
 * the center of a named token. Each shape fills in its own defaults (cone angle,
 * ray width, and a 45 degree rect direction when none is given). Foundry 13
 * creates a MeasuredTemplate; Foundry 14 (MeasuredTemplate removed, 14.352)
 * creates a Region flagged as this tool's own (see `systems/regions.ts`) so
 * `clear-templates` with `all` can find it again without ever touching a
 * hand-made GM region.
 */
function planTemplate(request: SceneTemplateRequest): SceneChangePlan {
  const docType = templateDocumentType();
  const scene = requireCurrentScene();
  const size = scene.grid?.size || 100;
  if (!request.shape || request.distance == null)
    throw new Error('shape and distance are required');

  let x = request.x;
  let y = request.y;
  if ((x == null || y == null) && request.originTokenName) {
    const token = findToken(scene, request.originTokenName);
    if (token) ({ x, y } = tokenCenter(scene, token));
  }
  if (x == null || y == null) {
    throw new Error('Provide x/y or a valid originTokenName.');
  }

  const direction = request.direction ?? (request.shape === 'rect' ? 45 : 0);
  const angle =
    request.shape === 'cone'
      ? (request.angle ?? (CONFIG as SceneDoc).MeasuredTemplate?.defaults?.angle ?? 53.13)
      : undefined;
  const width = request.shape === 'ray' ? (request.width ?? 5) : undefined;
  const fillColor = nonEmpty(request.fillColor) ?? userColor() ?? '#ff0000';

  let op: GuardedOp;
  if (docType === 'MeasuredTemplate') {
    const data: Record<string, unknown> = {
      t: request.shape,
      x,
      y,
      distance: request.distance,
      direction,
      fillColor,
    };
    if (angle !== undefined) data.angle = angle;
    if (width !== undefined) data.width = width;
    op = { kind: 'create', documentName: 'MeasuredTemplate', parentUuid: scene.uuid, data };
  } else {
    const params: TemplateParams = {
      shape: request.shape,
      distance: request.distance,
      x,
      y,
      direction,
    };
    if (angle !== undefined) params.angle = angle;
    if (width !== undefined) params.width = width;
    const data = buildTemplateRegionData(params, {
      pixelsPerUnit: size / (scene.grid?.distance || 5),
      color: fillColor,
      ...(sceneHasLevels(scene as Scene)
        ? { levels: [currentLevelId(scene as Scene)].filter(Boolean) as string[] }
        : {}),
    });
    op = { kind: 'create', documentName: 'Region', parentUuid: scene.uuid, data };
  }

  // Coverage is pure math over x/y/distance/direction/angle/width; feed it the
  // request shape directly rather than a created document (a Region has a
  // different shape than a MeasuredTemplate).
  const coverage: TemplateGeometry = {
    t: request.shape,
    x,
    y,
    distance: request.distance,
    direction,
  };
  if (angle !== undefined) coverage.angle = angle;
  if (width !== undefined) coverage.width = width;
  const inside = tokensInTemplate(scene, coverage);

  const units = scene.grid?.units || 'ft';
  return {
    summary: `Place a ${request.distance} ${units} ${request.shape} template on ${quoted(scene.name)}`,
    ops: [op],
    sceneId: scene.id,
    tokensInside: inside.map((t: SceneDoc) => ({
      name: t.name,
      actorId: t.actorId || t.actor?.id || null,
    })),
  };
}

/**
 * Plan removing an AoE template from the viewed scene by id, or all of this
 * tool's own templates when `all` is set. On Foundry 14 a template is a Region:
 * `all` and `templateId` only ever take Regions carrying this tool's flag
 * (`isToolTemplateRegion`), never a hand-made GM region.
 */
function planClearTemplates(request: SceneClearTemplatesRequest): SceneChangePlan {
  const docType = templateDocumentType();
  const scene = requireCurrentScene();
  const collection = contentsOf(docType === 'MeasuredTemplate' ? scene.templates : scene.regions);

  let found: SceneDoc[];
  if (request.all) {
    found =
      docType === 'MeasuredTemplate'
        ? collection
        : collection.filter((r: SceneDoc) =>
            isToolTemplateRegion(r as Parameters<typeof isToolTemplateRegion>[0])
          );
  } else if (request.templateId) {
    const one = collection.find((t: SceneDoc) => t.id === request.templateId);
    if (!one) throw new Error(`Template not found: ${request.templateId}`);
    // On Foundry 14 a Region is only a template when this tool placed it; a
    // hand-made GM region (a lair, a trap zone) is never cleared by id either.
    if (
      docType !== 'MeasuredTemplate' &&
      !isToolTemplateRegion(one as Parameters<typeof isToolTemplateRegion>[0])
    ) {
      throw new Error(`Region ${request.templateId} is not a template placed by the AI Tool.`);
    }
    found = [one];
  } else {
    throw new Error('Provide templateId or set all=true.');
  }
  if (found.length === 0) throw new Error('No templates to clear.');

  const ops: GuardedOp[] = found.map((t: SceneDoc) => ({
    kind: 'delete',
    uuid: embeddedUuid(scene, docType, t.id),
  }));
  const what = found.length === 1 ? 'a template' : `${found.length} templates`;
  return {
    summary: `Clear ${what} on ${quoted(scene.name)}`,
    ops,
    sceneId: scene.id,
  };
}

// ---------------------------------------------------------------------------
// Scene mood
// ---------------------------------------------------------------------------

/**
 * Plan a darkness level (clamped to 0..1) and/or global light change on the
 * viewed scene, with Foundry 13+'s `environment.*` schema.
 *
 * Foundry 14.368 (#14718, verified `client/documents/scene.mjs:1096-1099`):
 * the client silently drops a `environment.darknessLevel` update from a scene
 * with `environment.darknessLock` true unless the same update also sets
 * `environment.darknessLock` explicitly. Re-sending the scene's current lock
 * value alongside a darkness change is a no-op when unlocked, so it is
 * always included whenever darkness is set, with the scene's current value
 * (true or false), so a locked scene's darkness change takes effect and an
 * unlocked scene's is unchanged.
 */
function planMood(request: SceneMoodRequest): SceneChangePlan {
  const scene = requireCurrentScene();
  const changes: Record<string, unknown> = {};
  const parts: string[] = [];
  if (request.darkness != null) {
    const darkness = Math.max(0, Math.min(1, request.darkness));
    changes['environment.darknessLevel'] = darkness;
    changes['environment.darknessLock'] = Boolean(scene.environment?.darknessLock);
    parts.push(`darkness ${darkness}`);
  }
  if (request.globalLight != null) {
    changes['environment.globalLight.enabled'] = request.globalLight;
    parts.push(`global light ${request.globalLight ? 'enabled' : 'disabled'}`);
  }
  if (parts.length === 0) throw new Error('Give darkness and/or globalLight.');
  return {
    summary: `Set ${parts.join(' and ')} on ${quoted(scene.name)}`,
    ops: [{ kind: 'update', uuid: scene.uuid, changes }],
    sceneId: scene.id,
  };
}

// ---------------------------------------------------------------------------
// Map notes
// ---------------------------------------------------------------------------

/**
 * Plan a labeled, journal-linked map pin (Note) on the viewed scene. Position is
 * explicit `x`/`y` pixels or the position (not center) of a named token; an
 * optional journal entry is resolved by id or name.
 */
function planNote(request: SceneNoteRequest): SceneChangePlan {
  const scene = requireCurrentScene();

  let x = request.x;
  let y = request.y;
  if ((x == null || y == null) && request.tokenName) {
    const token = findToken(scene, request.tokenName);
    if (token) {
      x = token.x;
      y = token.y;
    }
  }
  if (x == null || y == null) {
    throw new Error('Provide x/y or a valid tokenName.');
  }

  let entryId = request.entryId;
  if (!entryId && request.journalName) {
    const wanted = request.journalName.toLowerCase();
    const journal =
      (game.journal as SceneDoc)?.getName?.(request.journalName) ||
      (game.journal as SceneDoc)?.find?.((e: SceneDoc) => e.name?.toLowerCase() === wanted);
    entryId = journal?.id;
  }

  // Note schema (common/documents/note.mjs:47-55, verified 14.368): x and y are
  // integers, iconSize an integer of at least 32.
  const data: Record<string, unknown> = {
    x: Math.round(x),
    y: Math.round(y),
    iconSize: Math.max(32, Math.round(request.iconSize ?? 40)),
    fontSize: 24,
    textAnchor: (CONST as SceneDoc).TEXT_ANCHOR_POINTS?.BOTTOM ?? 1,
    texture: { src: nonEmpty(request.icon) ?? 'icons/svg/book.svg' },
  };
  if (entryId) data.entryId = entryId;
  if (request.text) data.text = request.text;
  // Note#levels (v14 Scene Levels, common/documents/note.mjs:50, verified) is a
  // set of level ids (empty/omitted = every level); land the pin on the level
  // the GM is looking at, same as a token would need (plan table 2.4).
  if (sceneHasLevels(scene as Scene)) {
    const levelId = currentLevelId(scene as Scene);
    if (levelId) data.levels = [levelId];
  }

  const label = request.text ? `map note ${quoted(request.text)}` : 'a map note';
  return {
    summary: `Add ${label} on ${quoted(scene.name)}`,
    ops: [{ kind: 'create', documentName: 'Note', parentUuid: scene.uuid, data }],
    sceneId: scene.id,
  };
}

/**
 * Plan removing a map pin (Note) from the viewed scene by id, or every pin with
 * exactly this label (case-insensitive). No "remove all": that would clobber
 * pre-existing, hand-placed pins.
 */
function planRemoveNote(request: SceneRemoveNoteRequest): SceneChangePlan {
  const scene = requireCurrentScene();
  const notes = contentsOf(scene.notes);
  let found: SceneDoc[];
  if (request.noteId) {
    const one = notes.find((n: SceneDoc) => n.id === request.noteId);
    if (!one) throw new Error(`No map note found with id "${request.noteId}".`);
    found = [one];
  } else if (request.text) {
    const needle = request.text.toLowerCase();
    found = notes.filter((n: SceneDoc) => (n.text || '').toLowerCase() === needle);
    if (found.length === 0) {
      throw new Error(`No map note found with text "${request.text}".`);
    }
  } else {
    throw new Error('Provide noteId or text.');
  }
  const label =
    found.length === 1
      ? `map note ${found[0].text ? quoted(found[0].text) : String(found[0].id)}`
      : `${found.length} map notes`;
  return {
    summary: `Remove ${label} from ${quoted(scene.name)}`,
    ops: found.map((n: SceneDoc) => ({
      kind: 'delete' as const,
      uuid: embeddedUuid(scene, 'Note', n.id),
    })),
    sceneId: scene.id,
  };
}

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

/**
 * Create data for an Item copied onto an actor. Foundry's own
 * `game.items.fromCompendium(doc)` (client/documents/abstract/world-collection.mjs:109,
 * verified 14.368) drops `_id` and `sort`, resets `ownership` and, for a
 * compendium document, records `_stats.compendiumSource`; fall back to a plain
 * `toObject()` minus those fields when it is not there.
 */
function itemData(doc: { toObject(): Record<string, unknown> }): Record<string, unknown> {
  const items = game.items as unknown as {
    fromCompendium?: (doc: unknown) => Record<string, unknown>;
  };
  if (typeof items?.fromCompendium === 'function') return items.fromCompendium(doc);
  const data = doc.toObject();
  for (const key of ['_id', 'folder', 'sort', 'ownership']) delete data[key];
  return data;
}

/** The "5 gp, 3 sp + Longsword" loot line. */
function lootLine(coins: string[], itemNames: string[]): string {
  const parts: string[] = [];
  if (coins.length) parts.push(coins.join(', '));
  if (itemNames.length) parts.push(itemNames.join(', '));
  return parts.join(' + ');
}

/**
 * Plan loot: dnd5e currency (pp/gp/ep/sp/cp) added on top of the target's balance
 * (written as the new absolute values, worked out now) and/or items by UUID, and
 * a chat card announcing it. A target name that does not resolve fails the
 * plan; with no target at all it only announces. Bad item UUIDs are skipped and
 * listed.
 */
async function planLoot(request: SceneLootRequest): Promise<SceneChangePlan> {
  const actor = request.targetCharacter ? shared.resolveTargetActor(request.targetCharacter) : null;
  if (request.targetCharacter && !actor) {
    throw new Error(`Target not found: ${request.targetCharacter}`);
  }

  const ops: GuardedOp[] = [];
  const coins: string[] = [];
  const itemNames: string[] = [];
  const skippedItems: string[] = [];

  for (const key of CURRENCIES) {
    const added = request.currency?.[key];
    if (added == null || Number(added) === 0) continue;
    if (!Number.isFinite(Number(added))) throw new Error(`The ${key} amount must be a number.`);
    coins.push(`${added} ${key}`);
  }

  if (!actor && Array.isArray(request.itemUuids)) {
    // Items need somewhere to go: report them instead of dropping them silently.
    for (const uuid of request.itemUuids) skippedItems.push(`${uuid} (no target character)`);
  }

  if (actor) {
    const changes: Record<string, unknown> = {};
    for (const key of CURRENCIES) {
      const added = request.currency?.[key];
      if (added != null) {
        changes[`system.currency.${key}`] = (actor.system?.currency?.[key] ?? 0) + Number(added);
      }
    }
    if (Object.keys(changes).length > 0) ops.push({ kind: 'update', uuid: actor.uuid, changes });

    const fromUuidFn = (globalThis as SceneDoc).fromUuid;
    for (const uuid of Array.isArray(request.itemUuids) ? request.itemUuids : []) {
      try {
        const doc = fromUuidFn ? await fromUuidFn(uuid) : null;
        if (!doc) {
          skippedItems.push(uuid);
          continue;
        }
        if (doc.documentName !== 'Item') {
          skippedItems.push(`${uuid} (not an Item)`);
          continue;
        }
        const data = itemData(doc);
        itemNames.push(String(data.name));
        ops.push({ kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data });
      } catch {
        skippedItems.push(uuid); // bad uuid
      }
    }
  }

  const line = lootLine(coins, itemNames);
  if (request.announce !== false) {
    ops.push({
      kind: 'create',
      documentName: 'ChatMessage',
      data: {
        content: `<b>Loot${actor ? ` for ${String(actor.name)}` : ''}:</b> ${line || '(nothing)'}`,
        speaker: (ChatMessage as SceneDoc).getSpeaker({ alias: 'Loot' }),
      },
    });
  }
  if (ops.length === 0) throw new Error('Nothing to give: name a target with currency or items.');

  return {
    summary: `Loot${actor ? ` for ${String(actor.name)}` : ''}: ${line || '(nothing)'}`,
    ops,
    ...(skippedItems.length > 0 ? { skippedItems } : {}),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Build the plan for one request. Throws when nothing would change. */
export async function planSceneChange(data: unknown): Promise<SceneChangePlan> {
  const request = data as SceneChangeRequest | null | undefined;
  switch (request?.action) {
    case 'template':
      return planTemplate(request);
    case 'clear-templates':
      return planClearTemplates(request);
    case 'mood':
      return planMood(request);
    case 'note':
      return planNote(request);
    case 'remove-note':
      return planRemoveNote(request);
    case 'loot':
      return await planLoot(request);
    default:
      throw new Error(`Unknown action "${String(rec(data)?.action)}"`);
  }
}
