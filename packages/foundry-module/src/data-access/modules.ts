import * as shared from './shared.js';
import { diagnostics } from '../diagnostics.js';

/** Module inspection/diagnostics domain — extracted from FoundryDataAccess. */
export class ModulesDataAccess {
  /**
   * Inventory of installed modules with versions, active state, compatibility,
   * dependency satisfaction, and an `issues` list — plus core/system versions.
   */
  async getModules(data: { activeOnly?: boolean; withIssuesOnly?: boolean }): Promise<any> {
    shared.validateFoundryState();

    const fu = (globalThis as any).foundry?.utils;
    const isNewer = (a: any, b: any): boolean => {
      try {
        return !!(a && b && fu?.isNewerVersion?.(a, b));
      } catch {
        return false;
      }
    };

    const sys = game.system as any;
    const coreVer = game.version;

    const all = Array.from((game.modules as any).values()).map((m: any) => {
      const issues: string[] = [];
      const rel = m.relationships || {};
      const requiresRaw = Array.from(rel.requires ?? []);
      const requires = requiresRaw.map((r: any) => {
        const depId = r.id ?? r;
        const dep = (game.modules as any).get(depId) || (depId === sys?.id ? sys : null);
        const installed = !!dep;
        const active = dep?.active ?? (depId === sys?.id ? true : null);
        if (!installed) issues.push(`missing required dependency: ${depId}`);
        else if (active === false) issues.push(`required dependency inactive: ${depId}`);
        return { id: depId, installed, active, version: dep?.version ?? null };
      });

      const comp = m.compatibility || {};
      if (comp.maximum && isNewer(coreVer, comp.maximum)) {
        issues.push(`may be incompatible: declares max core ${comp.maximum}, running ${coreVer}`);
      }
      if (comp.minimum && isNewer(comp.minimum, coreVer)) {
        issues.push(`may be incompatible: declares min core ${comp.minimum}, running ${coreVer}`);
      }

      return {
        id: m.id,
        title: m.title,
        version: m.version,
        active: m.active,
        compatibility: {
          minimum: comp.minimum ?? null,
          verified: comp.verified ?? null,
          maximum: comp.maximum ?? null,
        },
        requires,
        issues,
      };
    });

    let modules = all;
    if (data.activeOnly) modules = modules.filter(m => m.active);
    if (data.withIssuesOnly) modules = modules.filter(m => m.issues.length > 0);

    return {
      success: true,
      foundryVersion: coreVer,
      system: { id: sys?.id ?? null, version: sys?.version ?? null },
      moduleCount: modules.length,
      activeCount: all.filter(m => m.active).length,
      modulesWithIssues: all.filter(m => m.issues.length > 0).length,
      modules,
    };
  }

  /**
   * Captured runtime errors/warnings (from the diagnostics buffer), with filters.
   * Includes a triage summary of counts by module and level.
   */
  async getModuleErrors(data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters: {
      level?: 'error' | 'warn';
      moduleId?: string;
      sinceTimestamp?: string;
      limit?: number;
    } = {};
    if (data.level !== undefined) filters.level = data.level;
    if (data.moduleId !== undefined) filters.moduleId = data.moduleId;
    if (data.sinceTimestamp !== undefined) filters.sinceTimestamp = data.sinceTimestamp;
    if (data.limit !== undefined) filters.limit = data.limit;

    const errors = diagnostics.getErrors(filters);
    return {
      success: true,
      count: errors.length,
      summary: diagnostics.summary(),
      errors,
    };
  }

  /** Clear the captured diagnostics buffer. */
  async clearModuleErrors(): Promise<any> {
    shared.validateFoundryState();
    const cleared = diagnostics.clear();
    return { success: true, cleared };
  }

  /** Full manifest of a single installed module, for deeper inspection. */
  async getModuleManifest(data: { moduleId: string }): Promise<any> {
    shared.validateFoundryState();
    const m = (game.modules as any).get(data.moduleId);
    if (!m) throw new Error(`Module not found: ${data.moduleId}`);
    return {
      success: true,
      manifest: {
        id: m.id,
        title: m.title,
        version: m.version,
        active: m.active,
        compatibility: shared.sanitizeData(m.compatibility),
        relationships: shared.sanitizeData(m.relationships),
        authors: shared.sanitizeData(m.authors),
        description: m.description,
        url: m.url,
        flags: shared.sanitizeData(m.flags),
      },
    };
  }
}
