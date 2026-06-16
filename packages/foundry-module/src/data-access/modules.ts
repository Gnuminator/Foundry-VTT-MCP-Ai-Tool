import * as shared from './shared.js';
import { diagnostics } from '../diagnostics.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Resolved state of a single required dependency. */
interface RequiredDep {
  id: string;
  installed: boolean;
  /** `null` when not installed; `true` when the dep id matches the active system. */
  active: boolean | null;
  version: string | null;
}

/** A single module's data as surfaced to tool consumers. */
interface ModuleSummary {
  id: string;
  title: string;
  version: string;
  active: boolean;
  compatibility: { minimum: string | null; verified: string | null; maximum: string | null };
  requires: RequiredDep[];
  issues: string[];
}

// ---------------------------------------------------------------------------
// Module inspection / diagnostics domain
// ---------------------------------------------------------------------------

/**
 * `ModulesDataAccess` — module inventory, compatibility analysis, and runtime
 * diagnostics for the Foundry bridge.
 *
 * Four responsibilities, each a public method:
 *   - `getModules`        — full inventory with dep-resolution + compat issues
 *   - `getModuleErrors`   — filtered view of the diagnostics ring-buffer
 *   - `clearModuleErrors` — drain the diagnostics buffer
 *   - `getModuleManifest` — sanitized full manifest for a single module
 */
export class ModulesDataAccess {
  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Inventory of all installed modules.
   *
   * For each module we compute:
   *   - Dependency resolution: each `relationships.requires` entry is looked up
   *     in `game.modules` or, when the dep id equals `game.system.id`, treated
   *     as the active system (always installed + active). Missing deps push a
   *     "missing required dependency" issue; installed-but-inactive deps push a
   *     "required dependency inactive" issue.
   *   - Compatibility issues: if `foundry.utils.isNewerVersion` is available
   *     and the running core version exceeds the module's declared maximum, or
   *     falls below its declared minimum, a "may be incompatible" issue is
   *     pushed. When `isNewerVersion` is absent (e.g. the test harness default)
   *     the branches are silently skipped.
   *
   * Counts (`activeCount`, `modulesWithIssues`) always reflect the FULL set of
   * installed modules, even when `activeOnly` or `withIssuesOnly` narrow the
   * returned `modules` array. `moduleCount` reflects the filtered list length.
   */
  async getModules(data: { activeOnly?: boolean; withIssuesOnly?: boolean }): Promise<any> {
    shared.validateFoundryState();

    const coreVer = game.version;
    const sys = game.system as any;

    // Wrap `foundry.utils.isNewerVersion` so any absence or exception is
    // absorbed: returns false rather than throwing.
    const isNewer = this.buildIsNewerVersion();

    // Build the full (unfiltered) inventory.
    const all: ModuleSummary[] = Array.from((game.modules as any).values()).map((m: any) =>
      this.summarizeModule(m, sys, coreVer, isNewer)
    );

    // Apply optional filters to the returned list only.
    let modules: ModuleSummary[] = all;
    if (data.activeOnly) modules = modules.filter(m => m.active);
    if (data.withIssuesOnly) modules = modules.filter(m => m.issues.length > 0);

    return {
      success: true,
      foundryVersion: coreVer,
      system: { id: sys?.id ?? null, version: sys?.version ?? null },
      // moduleCount tracks the *filtered* list; the two aggregate counts always use `all`.
      moduleCount: modules.length,
      activeCount: all.filter(m => m.active).length,
      modulesWithIssues: all.filter(m => m.issues.length > 0).length,
      modules,
    };
  }

  /**
   * Captured runtime errors/warnings from the diagnostics ring-buffer, with
   * optional filtering.
   *
   * Only filter keys whose values are not `undefined` are forwarded to
   * `diagnostics.getErrors()` — the diagnostics API treats a missing key
   * differently from an explicit `undefined`, so we must omit rather than
   * assign undefined.
   */
  async getModuleErrors(data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters = this.buildErrorFilters(data);
    const errors = diagnostics.getErrors(filters);

    return {
      success: true,
      count: errors.length,
      summary: diagnostics.summary(),
      errors,
    };
  }

  /** Drain the diagnostics buffer and report how many entries were cleared. */
  async clearModuleErrors(): Promise<any> {
    shared.validateFoundryState();
    return { success: true, cleared: diagnostics.clear() };
  }

  /**
   * Full sanitized manifest for a single installed module.
   *
   * Throws `Module not found: <id>` when the module id is not in `game.modules`.
   * The compatibility, relationships, authors, and flags fields are passed
   * through `shared.sanitizeData` to strip internal/sensitive fields and ensure
   * the value is a plain JSON-safe object.
   */
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

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Build a safe `isNewerVersion` wrapper that absorbs missing globals and
   * thrown errors, returning `false` as a conservative default.
   *
   * The function returned mirrors `foundry.utils.isNewerVersion(a, b)`:
   * returns `true` when version string `a` is strictly newer than `b`.
   */
  private buildIsNewerVersion(): (a: unknown, b: unknown) => boolean {
    const fu = (globalThis as any).foundry?.utils;
    return (a: unknown, b: unknown): boolean => {
      try {
        return !!(a && b && fu?.isNewerVersion?.(a, b));
      } catch {
        return false;
      }
    };
  }

  /**
   * Build a complete `ModuleSummary` for one module — dependency resolution
   * and compat-issue collection included.
   */
  private summarizeModule(
    m: any,
    sys: any,
    coreVer: string,
    isNewer: (a: unknown, b: unknown) => boolean
  ): ModuleSummary {
    const issues: string[] = [];
    const requires = this.resolveRequires(m, sys, issues);

    this.collectCompatIssues(m.compatibility, coreVer, isNewer, issues);

    const comp = m.compatibility || {};
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
  }

  /**
   * Resolve the `relationships.requires` list for a module.
   *
   * Each entry is looked up by id in `game.modules`. When the dep id equals the
   * active system id, the system object is used instead (it is always treated as
   * installed and active). Unresolved deps are flagged as missing; resolved but
   * inactive deps are flagged as inactive. Both conditions push to `issues`.
   */
  private resolveRequires(m: any, sys: any, issues: string[]): RequiredDep[] {
    const rel = m.relationships || {};
    const requiresRaw: any[] = Array.from(rel.requires ?? []);

    return requiresRaw.map((r: any) => {
      const depId: string = r.id ?? r;

      // The system itself can appear as a dependency; resolve it specially.
      const isSystemDep = depId === sys?.id;
      const dep = (game.modules as any).get(depId) || (isSystemDep ? sys : null);

      const installed = !!dep;
      // System deps are always considered active; otherwise read the dep's flag.
      const active: boolean | null = dep ? (isSystemDep ? true : (dep.active ?? null)) : null;

      if (!installed) {
        issues.push(`missing required dependency: ${depId}`);
      } else if (active === false) {
        issues.push(`required dependency inactive: ${depId}`);
      }

      return { id: depId, installed, active, version: dep?.version ?? null };
    });
  }

  /**
   * Push compatibility warnings onto `issues` when the running core version
   * falls outside the module's declared minimum/maximum range.
   *
   * Skipped entirely when `foundry.utils.isNewerVersion` is absent — the
   * `isNewer` wrapper returns `false` for any missing utility, so no issues
   * are generated in that environment.
   */
  private collectCompatIssues(
    compatibility: any,
    coreVer: string,
    isNewer: (a: unknown, b: unknown) => boolean,
    issues: string[]
  ): void {
    const comp = compatibility || {};

    // Core is NEWER than the declared maximum → likely incompatible.
    if (comp.maximum && isNewer(coreVer, comp.maximum)) {
      issues.push(`may be incompatible: declares max core ${comp.maximum}, running ${coreVer}`);
    }

    // Declared minimum is NEWER than the running core → requires a later core.
    if (comp.minimum && isNewer(comp.minimum, coreVer)) {
      issues.push(`may be incompatible: declares min core ${comp.minimum}, running ${coreVer}`);
    }
  }

  /**
   * Build the filters object passed to `diagnostics.getErrors()`.
   *
   * Keys whose values are `undefined` are intentionally omitted — the
   * diagnostics API distinguishes between "filter not set" and an explicit
   * `undefined`, so we must not include the key at all when no value was
   * provided.
   */
  private buildErrorFilters(data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }): {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  } {
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

    return filters;
  }
}
