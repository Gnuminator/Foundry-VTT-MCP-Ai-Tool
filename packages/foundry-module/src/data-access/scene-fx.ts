import { ERROR_MESSAGES } from '../constants.js';
import * as shared from './shared.js';
import {
  coreGeneration,
  currentLevelId,
  sceneHasLevels,
  supportsMeasuredTemplates,
  UnsupportedOnThisFoundryError,
} from '../systems/core.js';
import {
  buildTemplateRegionData,
  isToolTemplateRegion,
  supportsRegionDocuments,
} from '../systems/regions.js';

/**
 * Scene FX domain — measured (AoE) templates, scene mood (darkness / light /
 * playlist), journal-linked map pins, and loot drops.
 *
 * Every method operates on the *active* scene (`game.scenes.current`) and audits
 * its write. None gates on a write permission — these are GM-facing scene-dressing
 * tools, not the permission-guarded token writes. The AoE geometry is pure math
 * over the scene grid (no canvas), so token coverage is computed the same way
 * whether or not the scene is the one on screen.
 */
export class SceneFxDataAccess {
  // --- Shared internals ------------------------------------------------------

  /** The active scene, or throw `SCENE_NOT_FOUND` when there is none. */
  /**
   * Which document type an AoE "template" is stored as on this Foundry core:
   * MeasuredTemplate document on v13 (`supportsMeasuredTemplates()`), Region
   * document on v14 (MeasuredTemplate was removed 14.352, #13089; templates
   * are Regions with a `shapes` array — see `systems/regions.ts`). Throws only
   * when neither document type exists (not expected on any supported core).
   */
  private templateDocumentType(): 'MeasuredTemplate' | 'Region' {
    if (supportsMeasuredTemplates()) return 'MeasuredTemplate';
    if (supportsRegionDocuments()) return 'Region';
    throw new UnsupportedOnThisFoundryError(
      'Measured templates',
      'Neither MeasuredTemplate nor Region documents exist on this Foundry version.'
    );
  }

  private requireCurrentScene(): any {
    const scene = (game.scenes as any)?.current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }
    return scene;
  }

  /** Find a token on `scene` by (case-insensitive) name or by id. */
  private findToken(scene: any, nameOrId: string): any {
    const lowered = nameOrId.toLowerCase();
    return scene.tokens.find((t: any) => t.name?.toLowerCase() === lowered || t.id === nameOrId);
  }

  /**
   * Which tokens a measured template covers — a pure geometric test over the
   * scene grid (pixels-per-unit = gridSize / gridDistance), so it works for any
   * scene without a live canvas. Supports circle / ray / cone / rect.
   */
  private tokensInTemplate(scene: any, tpl: any): any[] {
    const grid = scene.grid || {};
    const size = grid.size || 100;
    const px = size / (grid.distance || 5); // pixels per distance unit
    const cx = tpl.x;
    const cy = tpl.y;
    const toRad = (d: number) => (d * Math.PI) / 180;
    return scene.tokens.filter((td: any) => {
      const tx = td.x + ((td.width ?? 1) * size) / 2;
      const ty = td.y + ((td.height ?? 1) * size) / 2;
      const dx = tx - cx;
      const dy = ty - cy;
      const distUnits = Math.hypot(dx, dy) / px;
      if (tpl.t === 'circle') return distUnits <= tpl.distance;
      if (tpl.t === 'ray') {
        const a = toRad(tpl.direction || 0);
        const lx = (dx * Math.cos(a) + dy * Math.sin(a)) / px;
        const ly = (-dx * Math.sin(a) + dy * Math.cos(a)) / px;
        return lx >= 0 && lx <= tpl.distance && Math.abs(ly) <= (tpl.width || 5) / 2;
      }
      if (tpl.t === 'cone') {
        if (distUnits > tpl.distance) return false;
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI - (tpl.direction || 0);
        ang = ((ang + 540) % 360) - 180;
        return Math.abs(ang) <= (tpl.angle || 53.13) / 2;
      }
      if (tpl.t === 'rect') {
        const a = toRad(tpl.direction || 0);
        const ex = cx + Math.cos(a) * tpl.distance * px;
        const ey = cy + Math.sin(a) * tpl.distance * px;
        return (
          tx >= Math.min(cx, ex) &&
          tx <= Math.max(cx, ex) &&
          ty >= Math.min(cy, ey) &&
          ty <= Math.max(cy, ey)
        );
      }
      return false;
    });
  }

  // --- Measured templates ----------------------------------------------------

  /**
   * Place an AoE template on the active scene and report which tokens it
   * covers. Origin is explicit `x`/`y` pixels, or the center of a named
   * token. Each shape fills in its own defaults (cone angle, ray width, and a
   * 45° rect direction when none is given). Foundry 13 creates a
   * MeasuredTemplate; Foundry 14 (MeasuredTemplate removed, 14.352) creates a
   * Region flagged as this tool's own (see `systems/regions.ts`) so
   * {@link deleteMeasuredTemplate}'s `all=true` can find it again without ever
   * touching a hand-made GM region.
   */
  async placeMeasuredTemplate(data: {
    shape: 'circle' | 'cone' | 'ray' | 'rect';
    distance: number;
    x?: number;
    y?: number;
    originTokenName?: string;
    direction?: number;
    angle?: number;
    width?: number;
    fillColor?: string;
  }): Promise<any> {
    shared.validateFoundryState();
    const docType = this.templateDocumentType();
    const scene = this.requireCurrentScene();
    const size = scene.grid?.size || 100;

    let x = data.x;
    let y = data.y;
    if ((x == null || y == null) && data.originTokenName) {
      const token = this.findToken(scene, data.originTokenName);
      if (token) {
        x = token.x + ((token.width ?? 1) * size) / 2;
        y = token.y + ((token.height ?? 1) * size) / 2;
      }
    }
    if (x == null || y == null) {
      throw new Error('Provide x/y or a valid originTokenName.');
    }

    const direction = data.direction ?? (data.shape === 'rect' ? 45 : 0);
    const angle =
      data.shape === 'cone'
        ? (data.angle ?? (CONFIG as any).MeasuredTemplate?.defaults?.angle ?? 53.13)
        : undefined;
    const width = data.shape === 'ray' ? (data.width ?? 5) : undefined;
    const fillColor = data.fillColor || (game.user as any)?.color || '#ff0000';

    let templateId: string;
    if (docType === 'MeasuredTemplate') {
      const tdata: any = { t: data.shape, x, y, distance: data.distance, direction, fillColor };
      if (angle !== undefined) tdata.angle = angle;
      if (width !== undefined) tdata.width = width;
      const created = await scene.createEmbeddedDocuments('MeasuredTemplate', [tdata]);
      const tpl = Array.isArray(created) ? created[0] : created;
      templateId = tpl.id;
    } else {
      const pixelsPerUnit = size / (scene.grid?.distance || 5);
      const params: Parameters<typeof buildTemplateRegionData>[0] = {
        shape: data.shape,
        distance: data.distance,
        x,
        y,
        direction,
      };
      if (angle !== undefined) params.angle = angle;
      if (width !== undefined) params.width = width;
      const regionData = buildTemplateRegionData(params, {
        pixelsPerUnit,
        color: fillColor,
        ...(sceneHasLevels(scene as Scene)
          ? { levels: [currentLevelId(scene as Scene)].filter(Boolean) as string[] }
          : {}),
      });
      const created = await scene.createEmbeddedDocuments('Region', [regionData]);
      const region = Array.isArray(created) ? created[0] : created;
      templateId = region.id;
    }

    // Coverage is pure math over x/y/distance/direction/angle/width; feed it
    // the request shape directly rather than re-reading the created document
    // (which has a different shape for a Region).
    const coverageTpl: any = { t: data.shape, x, y, distance: data.distance, direction };
    if (angle !== undefined) coverageTpl.angle = angle;
    if (width !== undefined) coverageTpl.width = width;
    const inside = this.tokensInTemplate(scene, coverageTpl);

    shared.auditLog('placeMeasuredTemplate', data, 'success');
    return {
      success: true,
      templateId,
      regionId: docType === 'Region' ? templateId : undefined,
      shape: data.shape,
      origin: { x, y },
      distance: data.distance,
      tokensInside: inside.map((t: any) => ({
        name: t.name,
        actorId: t.actorId || t.actor?.id || null,
      })),
    };
  }

  /**
   * Delete an AoE template from the active scene by id, or clear all of this
   * tool's own templates when `all` is set. On Foundry 14 a template is a
   * Region: `all=true` only ever deletes Regions carrying this tool's flag
   * (`isToolTemplateRegion`), never a hand-made GM region. Pairs with
   * {@link placeMeasuredTemplate}.
   */
  async deleteMeasuredTemplate(data: { templateId?: string; all?: boolean }): Promise<any> {
    shared.validateFoundryState();
    const docType = this.templateDocumentType();
    const scene = this.requireCurrentScene();

    let ids: string[];
    if (data.all) {
      if (docType === 'MeasuredTemplate') {
        ids = (scene.templates?.contents ?? scene.templates ?? []).map((t: any) => t.id);
      } else {
        const regions = scene.regions?.contents ?? scene.regions ?? [];
        ids = regions
          .filter((r: any) => isToolTemplateRegion(r as Parameters<typeof isToolTemplateRegion>[0]))
          .map((r: any) => r.id);
      }
    } else if (data.templateId) {
      ids = [data.templateId];
    } else {
      throw new Error('Provide templateId or set all=true.');
    }

    if (ids.length > 0) {
      await scene.deleteEmbeddedDocuments(docType, ids);
    }
    shared.auditLog('deleteMeasuredTemplate', data, 'success');
    return { success: true, deletedCount: ids.length, templateIds: ids };
  }

  // --- Scene mood ------------------------------------------------------------

  /**
   * Set scene mood: darkness level (clamped to [0,1]) and/or global light, plus
   * optional playlist play/stop. Darkness/light use Foundry v13+'s `environment.*`
   * schema, falling back to the flat pre-v13 fields. The v13+ check reads the
   * core generation via `systems/core.ts`'s `coreGeneration()` (`game.release`,
   * falling back to parsing `game.version`) instead of parsing the version
   * string locally. The response echoes the raw requested darkness/globalLight
   * (not the clamped/normalized values).
   *
   * Foundry 14.368 (#14718, verified `client/documents/scene.mjs:1096-1099`):
   * the client silently drops a `environment.darknessLevel` update from a scene
   * with `environment.darknessLock` true unless the same update also sets
   * `environment.darknessLock` explicitly. Re-sending the scene's current lock
   * value alongside a darkness change is a no-op when unlocked, so it is always
   * included rather than only on the affected core builds.
   */
  async setSceneMood(data: {
    darkness?: number;
    globalLight?: boolean;
    playlistName?: string;
    playlistAction?: 'play' | 'stop';
  }): Promise<any> {
    shared.validateFoundryState();
    const scene = this.requireCurrentScene();

    const v13plus = coreGeneration() >= 13;
    const update: any = {};
    if (data.darkness != null) {
      const d = Math.max(0, Math.min(1, data.darkness));
      if (v13plus) {
        update['environment.darknessLevel'] = d;
        if (scene.environment?.darknessLock) {
          update['environment.darknessLock'] = scene.environment.darknessLock;
        }
      } else {
        update.darkness = d;
      }
    }
    if (data.globalLight != null) {
      if (v13plus) update['environment.globalLight.enabled'] = data.globalLight;
      else update.globalLight = data.globalLight;
    }
    if (Object.keys(update).length > 0) {
      await scene.update(update);
    }

    const playlist = await this.runPlaylist(data.playlistName, data.playlistAction);

    shared.auditLog('setSceneMood', data, 'success');
    return {
      success: true,
      sceneId: scene.id,
      darkness: data.darkness ?? null,
      globalLight: data.globalLight ?? null,
      playlist,
    };
  }

  /**
   * Resolve a playlist by name and play/stop it (default: play). Returns a
   * human-readable status string, or null when no playlist was requested, or a
   * "not found" message when the name doesn't resolve.
   */
  private async runPlaylist(
    playlistName: string | undefined,
    action: 'play' | 'stop' | undefined
  ): Promise<string | null> {
    if (!playlistName) {
      return null;
    }
    const pl =
      (game.playlists as any)?.getName?.(playlistName) ||
      (game.playlists as any)?.find?.(
        (p: any) => p.name?.toLowerCase() === playlistName.toLowerCase()
      );
    if (!pl) {
      return `Playlist not found: ${playlistName}`;
    }
    const verb = action || 'play';
    if (verb === 'stop') {
      await pl.stopAll();
    } else {
      await pl.playAll();
    }
    return `${verb} "${pl.name}"`;
  }

  // --- Map notes -------------------------------------------------------------

  /**
   * Drop a labeled, journal-linked map pin (Note) on the active scene. Position
   * is explicit `x`/`y` pixels or the position (not center) of a named token; an
   * optional journal entry is resolved by id or name.
   */
  async addMapNote(data: {
    text?: string;
    x?: number;
    y?: number;
    tokenName?: string;
    journalName?: string;
    entryId?: string;
    icon?: string;
    iconSize?: number;
  }): Promise<any> {
    shared.validateFoundryState();
    const scene = this.requireCurrentScene();

    let x = data.x;
    let y = data.y;
    if ((x == null || y == null) && data.tokenName) {
      const token = this.findToken(scene, data.tokenName);
      if (token) {
        x = token.x;
        y = token.y;
      }
    }
    if (x == null || y == null) {
      throw new Error('Provide x/y or a valid tokenName.');
    }

    let entryId = data.entryId;
    if (!entryId && data.journalName) {
      const journal =
        (game.journal as any)?.getName?.(data.journalName) ||
        (game.journal as any)?.find?.(
          (e: any) => e.name?.toLowerCase() === data.journalName!.toLowerCase()
        );
      entryId = journal?.id;
    }

    const noteData: any = {
      x,
      y,
      iconSize: data.iconSize ?? 40,
      fontSize: 24,
      textAnchor: (CONST as any).TEXT_ANCHOR_POINTS?.BOTTOM ?? 1,
      texture: { src: data.icon || 'icons/svg/book.svg' },
    };
    if (entryId) noteData.entryId = entryId;
    if (data.text) noteData.text = data.text;
    // Note#levels (v14 Scene Levels, common/documents/note.mjs:50, verified) is a
    // set of level ids (empty/omitted = every level); land the pin on the level
    // the GM is looking at, same as a token would need (plan table 2.4).
    if (sceneHasLevels(scene as Scene)) {
      const levelId = currentLevelId(scene as Scene);
      if (levelId) noteData.levels = [levelId];
    }

    const created = await scene.createEmbeddedDocuments('Note', [noteData]);
    const note = Array.isArray(created) ? created[0] : created;

    shared.auditLog('addMapNote', data, 'success');
    return {
      success: true,
      noteId: note.id,
      x,
      y,
      entryId: entryId ?? null,
      text: data.text ?? null,
    };
  }

  /**
   * Delete a map pin (Note) from the active scene by id, or by matching label
   * text. (No "delete all" — that would clobber pre-existing, hand-placed pins.)
   */
  async deleteMapNote(data: { noteId?: string; text?: string }): Promise<any> {
    shared.validateFoundryState();
    const scene = this.requireCurrentScene();

    const notes = scene.notes?.contents ?? scene.notes ?? [];
    let ids: string[];
    if (data.noteId) {
      ids = [data.noteId];
    } else if (data.text) {
      const needle = data.text.toLowerCase();
      ids = notes.filter((n: any) => (n.text || '').toLowerCase() === needle).map((n: any) => n.id);
      if (ids.length === 0) {
        throw new Error(`No map note found with text "${data.text}".`);
      }
    } else {
      throw new Error('Provide noteId or text.');
    }

    await scene.deleteEmbeddedDocuments('Note', ids);
    shared.auditLog('deleteMapNote', data, 'success');
    return { success: true, deletedCount: ids.length, noteIds: ids };
  }

  // --- Loot ------------------------------------------------------------------

  /**
   * Award loot: add currency and/or compendium items (by UUID) to a character,
   * and/or announce it in chat. Currency is added on top of the actor's current
   * balance; items are imported via their UUID. A missing `targetCharacter`
   * throws; with no target at all it just announces.
   */
  async dropLoot(data: {
    targetCharacter?: string;
    currency?: Record<string, number>;
    itemUuids?: string[];
    announce?: boolean;
  }): Promise<any> {
    shared.validateFoundryState();

    const actor = data.targetCharacter ? shared.resolveTargetActor(data.targetCharacter) : null;
    if (data.targetCharacter && !actor) {
      throw new Error(`Target not found: ${data.targetCharacter}`);
    }

    const itemsAdded: string[] = [];
    if (actor) {
      await this.grantCurrency(actor, data.currency);
      await this.grantItems(actor, data.itemUuids, itemsAdded);
    }

    const summary = this.lootSummary(data.currency, itemsAdded);
    if (data.announce !== false) {
      await (ChatMessage as any).create({
        content: `<b>Loot${actor ? ` for ${actor.name}` : ''}:</b> ${summary || '(nothing)'}`,
        speaker: (ChatMessage as any).getSpeaker({ alias: 'Loot' }),
      });
    }

    shared.auditLog('dropLoot', data, 'success');
    return {
      success: true,
      target: actor?.name ?? null,
      currency: data.currency ?? null,
      itemsAdded,
      summary,
    };
  }

  /** Add dnd5e currency (pp/gp/ep/sp/cp) to an actor, on top of its balance. */
  private async grantCurrency(actor: any, currency?: Record<string, number>): Promise<void> {
    if (!currency) return;
    const upd: any = {};
    for (const k of ['pp', 'gp', 'ep', 'sp', 'cp']) {
      if (currency[k] != null) {
        upd[`system.currency.${k}`] = (actor.system?.currency?.[k] ?? 0) + Number(currency[k]);
      }
    }
    if (Object.keys(upd).length > 0) {
      await actor.update(upd);
    }
  }

  /** Import items onto an actor by UUID, recording the names added. Bad UUIDs are skipped. */
  private async grantItems(
    actor: any,
    itemUuids: string[] | undefined,
    added: string[]
  ): Promise<void> {
    if (!Array.isArray(itemUuids) || itemUuids.length === 0) return;
    const fromUuidFn = (globalThis as any).fromUuid;
    const itemData: any[] = [];
    for (const uuid of itemUuids) {
      try {
        const doc = fromUuidFn ? await fromUuidFn(uuid) : null;
        if (doc) {
          const obj = doc.toObject();
          delete obj._id;
          itemData.push(obj);
          added.push(obj.name);
        }
      } catch {
        // skip bad uuid
      }
    }
    if (itemData.length > 0) {
      await actor.createEmbeddedDocuments('Item', itemData);
    }
  }

  /** Build the "5 gp, 3 sp + Longsword" loot summary string. */
  private lootSummary(currency: Record<string, number> | undefined, itemsAdded: string[]): string {
    const parts: string[] = [];
    if (currency) {
      const coins = Object.entries(currency)
        .filter(([, v]) => v)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      if (coins) parts.push(coins);
    }
    if (itemsAdded.length) parts.push(itemsAdded.join(', '));
    return parts.join(' + ');
  }
}
