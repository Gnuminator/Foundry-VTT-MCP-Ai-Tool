/**
 * Test helper: a fake Foundry module with enough of snapshotGuardedOps /
 * applyGuardedOps to run plan -> apply -> undo end to end against the real
 * GuardedWriteService (the real module side is tested in foundry-module).
 * Extra bridge methods can be added per test through `handlers`.
 */
import { vi } from 'vitest';

import type {
  GuardedApplyRequest,
  GuardedOp,
  GuardedOpResult,
  OpSnapshot,
  PathValue,
} from '@gnuminator/shared';

import { readDataPath, samePathValue, writeDataPath } from '../guarded-write/values.js';

// ---------------------------------------------------------------------------
// A fake Foundry module: enough of snapshotGuardedOps/applyGuardedOps to run
// plan -> apply -> undo end to end (the real one is tested in the module).
// ---------------------------------------------------------------------------

export interface FakeDoc {
  documentName: string;
  source: Record<string, any>;
}

export class FakeFoundry {
  /** Extra bridge methods: name -> handler. */
  handlers: Record<string, (data: any) => unknown> = {};
  docs = new Map<string, FakeDoc>();
  features = [{ id: 'test-feature', name: 'Test', hint: '', enabled: true }];
  worldId = 'curse-of-strahd';
  connected = true;
  failLogGmChange = false;
  private seq = 0;
  private clock = 100;
  readonly calls: Array<[string, any]> = [];

  add(uuid: string, documentName: string, source: Record<string, any>): FakeDoc {
    const doc = {
      documentName,
      source: { ...source, _stats: { modifiedTime: (this.clock += 1) } },
    };
    this.docs.set(uuid, doc);
    return doc;
  }

  edit(uuid: string, pathValue: PathValue): void {
    const doc = this.docs.get(uuid)!;
    doc.source = writeDataPath(doc.source, pathValue);
    doc.source._stats = { modifiedTime: (this.clock += 1) };
  }

  query = vi.fn((method: string, data?: any): Promise<any> => {
    this.calls.push([method, data]);
    if (!this.connected) return Promise.reject(new Error('Foundry VTT module not connected'));
    try {
      return Promise.resolve(this.handle(method, data));
    } catch (error) {
      return Promise.reject(error);
    }
  });

  private handle(method: string, data: any): unknown {
    switch (method) {
      case 'foundry-mcp-bridge.getWorldInfo':
        return { id: this.worldId };
      case 'foundry-mcp-bridge.snapshotGuardedOps':
        return (data.ops as GuardedOp[]).map(op => this.snapshot(op));
      case 'foundry-mcp-bridge.applyGuardedOps':
        return this.apply(data as GuardedApplyRequest);
      case 'foundry-mcp-bridge.listGuardedFeatures':
        return this.features;
      case 'foundry-mcp-bridge.logGmChange':
        if (this.failLogGmChange) throw new Error('feed unavailable');
        return { logged: true };
      default:
        if (this.handlers[method]) return this.handlers[method](data);
        throw new Error(`unexpected ${method}`);
    }
  }

  private paths(op: Extract<GuardedOp, { kind: 'update' }>): string[] {
    return [...Object.keys(op.changes), ...(op.unset ?? [])];
  }

  private snapshot(op: GuardedOp): OpSnapshot {
    if (op.kind === 'create') {
      const idTaken =
        op.keepId === true &&
        this.docs.has(
          `${op.parentUuid ? `${op.parentUuid}.` : ''}${op.documentName}.${String(op.data._id)}`
        );
      return {
        exists: op.parentUuid ? this.docs.has(op.parentUuid) : true,
        documentName: op.documentName,
        name: (op.data.name as string) ?? null,
        idTaken,
      };
    }
    const doc = this.docs.get(op.uuid);
    if (!doc) return { exists: false };
    const base = { exists: true, documentName: doc.documentName, name: doc.source.name ?? null };
    if (op.kind === 'delete') return { ...base, modifiedTime: doc.source._stats.modifiedTime };
    return { ...base, values: this.paths(op).map(p => readDataPath(doc.source, p)) };
  }

  private apply(req: GuardedApplyRequest): unknown {
    if (req.mode === 'apply') {
      const feature = this.features.find(f => f.id === req.feature);
      if (!feature?.enabled) throw new Error(`The "${req.feature}" feature is switched off`);
    }
    req.ops.forEach((op, i) => {
      const now = this.snapshot(op);
      const want = req.expected[i];
      const same =
        op.kind === 'create'
          ? now.exists && !now.idTaken
          : now.exists === want.exists &&
            (op.kind === 'delete'
              ? want.modifiedTime == null || want.modifiedTime === now.modifiedTime
              : (want.values ?? []).every((v, j) => samePathValue(v, now.values![j])));
      if (!same) throw new Error(`Conflict, nothing was written: op ${i}`);
    });
    const results: GuardedOpResult[] = req.ops.map((op, index) => {
      if (op.kind === 'update') {
        const doc = this.docs.get(op.uuid)!;
        const paths = this.paths(op);
        const before = paths.map(p => readDataPath(doc.source, p));
        for (const [p, value] of Object.entries(op.changes)) {
          doc.source = writeDataPath(doc.source, { path: p, present: true, value });
        }
        for (const p of op.unset ?? []) {
          doc.source = writeDataPath(doc.source, { path: p, present: false });
        }
        doc.source._stats = { modifiedTime: (this.clock += 1) };
        return {
          index,
          kind: 'update',
          uuid: op.uuid,
          documentName: doc.documentName,
          name: doc.source.name ?? null,
          parentUuid: null,
          before,
          after: paths.map(p => readDataPath(doc.source, p)),
        };
      }
      if (op.kind === 'create') {
        const id = op.keepId ? String(op.data._id) : `new${(this.seq += 1)}`;
        const uuid = `${op.parentUuid ? `${op.parentUuid}.` : ''}${op.documentName}.${id}`;
        const doc = this.add(uuid, op.documentName, { ...op.data, _id: id });
        // Like Foundry, embedded data created with the parent keeps its ids.
        for (const page of (op.data.pages as Array<Record<string, any>> | undefined) ?? []) {
          this.add(`${uuid}.JournalEntryPage.${String(page._id)}`, 'JournalEntryPage', page);
        }
        return {
          index,
          kind: 'create',
          uuid,
          documentName: op.documentName,
          name: doc.source.name ?? null,
          parentUuid: op.parentUuid ?? null,
          modifiedTime: doc.source._stats.modifiedTime,
        };
      }
      const doc = this.docs.get(op.uuid)!;
      for (const key of [...this.docs.keys()]) {
        if (key === op.uuid || key.startsWith(`${op.uuid}.`)) this.docs.delete(key);
      }
      return {
        index,
        kind: 'delete',
        uuid: op.uuid,
        documentName: doc.documentName,
        name: doc.source.name ?? null,
        parentUuid: null,
        deleted: doc.source,
      };
    });
    return {
      changeId: req.changeId,
      mode: req.mode,
      appliedAt: '2026-09-28T12:00:00.000Z',
      results,
    };
  }
}
