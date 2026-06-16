import * as shared from './shared.js';

/**
 * Item summary as surfaced to list consumers.
 * `img` is omitted entirely when the document has no image (falsy) — a test
 * asserts `not.toHaveProperty('img')` for items with an empty img string.
 */
interface ItemSummary {
  id: string;
  name: string;
  type: string;
  img?: string;
  folderId: string | null;
  folderName: string | null;
}

/**
 * World-level Item document domain — list, create, and update items in the
 * Foundry Items sidebar (not embedded actor items).
 *
 * All three public methods delegate cross-cutting plumbing to `./shared.js`.
 * Writes are recorded via {@link shared.auditLog}; there is no additional
 * permission gate (item writes are unrestricted once Foundry is ready).
 */
export class WorldItemsDataAccess {
  // ===== READS =====

  /**
   * List world-level Item documents from the Items sidebar.
   *
   * All three filter params are optional and stack (AND logic):
   * - `type` — exact match on `item.type`
   * - `folder` — resolved to a folder id by name-or-id; returns `[]` when the
   *   folder string is supplied but no matching folder exists
   * - `nameFilter` — case-insensitive substring match on `item.name`
   */
  async listWorldItems(params: {
    type?: string;
    folder?: string;
    nameFilter?: string;
  }): Promise<ItemSummary[]> {
    shared.validateFoundryState();

    const { type, folder, nameFilter } = params;
    const nameLower = nameFilter ? nameFilter.toLowerCase() : null;

    // Resolve the folder filter to an id up front so each item loop is O(1).
    let folderId: string | null = null;
    if (folder && folder.trim().length > 0) {
      const folderDoc = this.findItemFolder(folder.trim());
      if (!folderDoc) {
        // Folder param given but not found → empty result (pinned by test).
        return [];
      }
      folderId = folderDoc.id;
    }

    const result: ItemSummary[] = [];

    for (const item of (game as any).items) {
      if (type && item.type !== type) continue;
      if (folderId && item.folder?.id !== folderId) continue;
      if (nameLower && !(item.name ?? '').toLowerCase().includes(nameLower)) continue;

      result.push(this.summarizeItem(item));
    }

    return result;
  }

  // ===== WRITES =====

  /**
   * Update one or more existing world-level Item documents in a single batched
   * `Item.updateDocuments()` call.
   *
   * Validates every entry before issuing any write — the entire batch is
   * aborted if any entry has a missing/blank `id` or refers to an unknown item.
   * Folder lookup is cached per-call; a folder name that doesn't exist is
   * created automatically (same as {@link createWorldItems}).
   */
  async updateWorldItems(params: {
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      system?: Record<string, any>;
      folder?: string;
    }>;
  }): Promise<{
    updated: Array<{ id: string; name: string; type: string }>;
  }> {
    shared.validateFoundryState();

    const { updates } = params;

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('updates array is required and must contain at least one entry');
    }

    // Folder-resolution cache: folder param string → resolved folder id.
    // Avoids repeated game.folders scans + duplicate Folder.create calls.
    const folderCache = new Map<string, string>();

    // Build the payload array, validating and resolving folders as we go.
    const payload: Array<Record<string, any>> = [];

    for (let idx = 0; idx < updates.length; idx++) {
      const upd = updates[idx];
      if (!upd || typeof upd.id !== 'string' || upd.id.trim().length === 0) {
        throw new Error(`updates[${idx}]: "id" is required and must be a non-empty string`);
      }

      const item = (game as any).items?.get(upd.id);
      if (!item) {
        throw new Error(`updates[${idx}]: Item "${upd.id}" not found in world`);
      }

      const patch: Record<string, any> = { _id: upd.id };
      if (upd.name !== undefined) patch.name = upd.name;
      if (upd.img !== undefined) patch.img = upd.img;
      if (upd.system !== undefined) patch.system = upd.system;
      if (upd.folder !== undefined && upd.folder.trim().length > 0) {
        patch.folder = await this.resolveFolderIdCached(upd.folder.trim(), folderCache);
      }

      payload.push(patch);
    }

    try {
      const updated = await (Item as any).updateDocuments(payload);

      const result = {
        updated: (updated ?? []).map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
        })),
      };

      shared.auditLog('updateWorldItems', { count: payload.length }, 'success');
      return result;
    } catch (error) {
      shared.auditLog(
        'updateWorldItems',
        { count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Create one or more world-level Item documents (Items sidebar, not embedded
   * on an actor). Items are batched into a single `Item.createDocuments()` call.
   *
   * Validates every item's `name`/`type` — and checks the system's declared
   * valid types when `game.system.documentTypes.Item` is populated — before
   * issuing any write. The optional `folder` is resolved or created once and
   * applied to all items in the batch.
   */
  async createWorldItems(params: {
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
    folder?: string;
  }): Promise<{
    folderId: string | null;
    folderName: string | null;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    shared.validateFoundryState();

    const { items, folder } = params;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    // Resolve the set of valid Item types from the active system, if declared.
    const validTypes = this.resolveValidItemTypes();

    // Validate and map input items to creation payload objects.
    const payload = items.map((it, idx) => {
      if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
        throw new Error(`items[${idx}]: "name" is required and must be a non-empty string`);
      }
      if (typeof it.type !== 'string' || it.type.trim().length === 0) {
        throw new Error(`items[${idx}] ("${it.name}"): "type" is required`);
      }
      if (validTypes && !validTypes.includes(it.type)) {
        const systemId = game.system?.id;
        throw new Error(
          `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${systemId}". ` +
            `Valid Item types: ${validTypes.join(', ')}`
        );
      }

      const doc: Record<string, any> = { name: it.name, type: it.type };
      if (it.img) doc.img = it.img;
      if (it.system && typeof it.system === 'object') doc.system = it.system;
      return doc;
    });

    // Resolve or create the target folder (once for the whole batch).
    let folderDoc: any = null;
    if (folder && folder.trim().length > 0) {
      folderDoc = await this.resolveOrCreateItemFolder(folder.trim());
      for (const doc of payload) {
        doc.folder = folderDoc.id;
      }
    }

    try {
      const created = await (Item as any).createDocuments(payload);

      const result = {
        folderId: folderDoc ? (folderDoc.id as string) : null,
        folderName: folderDoc ? (folderDoc.name as string) : null,
        created: (created ?? []).map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
        })),
      };

      shared.auditLog(
        'createWorldItems',
        { folder: folder ?? null, count: payload.length },
        'success'
      );
      return result;
    } catch (error) {
      shared.auditLog(
        'createWorldItems',
        { folder: folder ?? null, count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ===== internals =====

  /**
   * Build a lightweight {@link ItemSummary} from a live Foundry Item document.
   * `img` is only included in the output object when the field is truthy — a
   * test asserts `not.toHaveProperty('img')` for items with an empty/null img.
   */
  private summarizeItem(item: any): ItemSummary {
    return {
      id: item.id ?? '',
      name: item.name ?? '',
      type: item.type,
      ...(item.img ? { img: item.img } : {}),
      folderId: item.folder?.id ?? null,
      folderName: item.folder?.name ?? null,
    };
  }

  /**
   * Find an Item-type folder by name or id from `game.folders`. Returns
   * `undefined` when none match (callers handle the missing-folder branch).
   */
  private findItemFolder(nameOrId: string): any {
    return (
      (game as any).folders?.find(
        (f: any) => f.type === 'Item' && (f.name === nameOrId || f.id === nameOrId)
      ) ?? null
    );
  }

  /**
   * Resolve a folder name/id to its Foundry id, creating the folder on first
   * miss. Results are memoized in `cache` to avoid duplicate creates when the
   * same folder param appears on multiple entries in a single batch.
   */
  private async resolveFolderIdCached(
    folderParam: string,
    cache: Map<string, string>
  ): Promise<string> {
    if (cache.has(folderParam)) return cache.get(folderParam)!;

    const folderDoc = await this.resolveOrCreateItemFolder(folderParam);
    cache.set(folderParam, folderDoc.id);
    return folderDoc.id;
  }

  /**
   * Find an existing Item folder by name-or-id, or create a bare one when none
   * exists. Returns the folder document (always has `.id` + `.name`).
   */
  private async resolveOrCreateItemFolder(nameOrId: string): Promise<any> {
    const existing = this.findItemFolder(nameOrId);
    if (existing) return existing;

    return (Folder as any).create({ name: nameOrId, type: 'Item', parent: null });
  }

  /**
   * Return the list of valid Item type keys from the active game system, or
   * `null` when the system hasn't declared them (in which case any type is
   * accepted). Used by {@link createWorldItems} to validate input.
   */
  private resolveValidItemTypes(): string[] | null {
    const itemDocTypes = (game as any).system?.documentTypes?.Item;
    if (itemDocTypes && typeof itemDocTypes === 'object') {
      return Object.keys(itemDocTypes);
    }
    return null;
  }
}
