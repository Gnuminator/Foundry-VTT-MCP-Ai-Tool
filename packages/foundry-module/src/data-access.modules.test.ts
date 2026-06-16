/**
 * Characterization tests for the module-inspection surface of
 * `FoundryDataAccess`: `getModules` and `getModuleManifest`.
 *
 * These pin the current (upstream-derived) behavior so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity. The Phase 9
 * Foundry-mock harness provides the in-memory `game.modules` Map.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// =============================================================================
// getModules — envelope + basic shape
// =============================================================================

describe('FoundryDataAccess — getModules basic envelope', () => {
  it('returns success envelope with foundryVersion, system, counts, and modules array', async () => {
    world.addModule({ id: 'mod-a', title: 'Mod A', version: '1.0.0', active: true });

    const result = await da.getModules({});

    expect(result.success).toBe(true);
    expect(result.foundryVersion).toBe('13.331');
    expect(result.system).toEqual({ id: 'dnd5e', version: '4.0.0' });
    expect(Array.isArray(result.modules)).toBe(true);
    expect(typeof result.moduleCount).toBe('number');
    expect(typeof result.activeCount).toBe('number');
    expect(typeof result.modulesWithIssues).toBe('number');
  });

  it('maps each module to the expected shape with compatibility ?? null defaults', async () => {
    world.addModule({
      id: 'mod-b',
      title: 'Mod B',
      version: '2.0.0',
      active: false,
      compatibility: { minimum: '12.0', verified: '13.0' },
      // maximum intentionally omitted → should be null
    });

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'mod-b');

    expect(mod).toMatchObject({
      id: 'mod-b',
      title: 'Mod B',
      version: '2.0.0',
      active: false,
      compatibility: { minimum: '12.0', verified: '13.0', maximum: null },
      requires: [],
      issues: [],
    });
  });

  it('reports null for all compatibility fields when compatibility is absent', async () => {
    world.addModule({ id: 'mod-c', title: 'Mod C', version: '1.0.0', active: true });
    // No compatibility property at all on makeModule's defaults

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'mod-c');

    expect(mod.compatibility).toEqual({ minimum: null, verified: null, maximum: null });
  });
});

// =============================================================================
// getModules — dependency resolution
// =============================================================================

describe('FoundryDataAccess — getModules dependency resolution', () => {
  it('marks an installed and active dependency as installed+active with its version', async () => {
    world.addModule({ id: 'dep-lib', title: 'Dep Lib', version: '3.1.0', active: true });
    world.addModule({
      id: 'consumer',
      title: 'Consumer',
      version: '1.0.0',
      active: true,
      relationships: { requires: [{ id: 'dep-lib' }] },
    });

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'consumer');

    expect(mod.requires).toEqual([
      { id: 'dep-lib', installed: true, active: true, version: '3.1.0' },
    ]);
    expect(mod.issues).toEqual([]);
  });

  it('pushes "missing required dependency" issue when dep is not installed', async () => {
    world.addModule({
      id: 'needs-missing',
      title: 'Needs Missing',
      version: '1.0.0',
      active: true,
      relationships: { requires: [{ id: 'ghost-module' }] },
    });

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'needs-missing');

    expect(mod.requires).toEqual([
      { id: 'ghost-module', installed: false, active: null, version: null },
    ]);
    expect(mod.issues).toContain('missing required dependency: ghost-module');
  });

  it('pushes "required dependency inactive" issue when dep is installed but inactive', async () => {
    world.addModule({ id: 'sleeping-dep', title: 'Sleeping Dep', version: '1.0.0', active: false });
    world.addModule({
      id: 'awake-consumer',
      title: 'Awake Consumer',
      version: '1.0.0',
      active: true,
      relationships: { requires: [{ id: 'sleeping-dep' }] },
    });

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'awake-consumer');

    expect(mod.requires[0]).toMatchObject({ id: 'sleeping-dep', installed: true, active: false });
    expect(mod.issues).toContain('required dependency inactive: sleeping-dep');
  });

  it('resolves a system dependency (dep id === game.system.id) as installed and active', async () => {
    world.addModule({
      id: 'system-dep-consumer',
      title: 'System Dep Consumer',
      version: '1.0.0',
      active: true,
      relationships: { requires: [{ id: 'dnd5e' }] },
    });

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'system-dep-consumer');

    // system dep: installed=true (sys object exists), active=true (hardcoded for system)
    expect(mod.requires).toEqual([
      { id: 'dnd5e', installed: true, active: true, version: '4.0.0' },
    ]);
    expect(mod.issues).toEqual([]);
  });
});

// =============================================================================
// getModules — compatibility issues (isNewerVersion branch)
// =============================================================================

describe('FoundryDataAccess — getModules compatibility issues', () => {
  it('flags "may be incompatible: declares max core X, running Y" when core exceeds max', async () => {
    world.addModule({
      id: 'old-mod',
      title: 'Old Mod',
      version: '1.0.0',
      active: true,
      compatibility: { maximum: '12.999', verified: '12.0' },
    });

    // Inject isNewerVersion locally so the max-core branch fires.
    // coreVer='13.331', comp.maximum='12.999' → isNewer('13.331','12.999')=true
    (globalThis as any).foundry.utils.isNewerVersion = (a: string, b: string): boolean => {
      const toNum = (v: string) => v.split('.').map(Number);
      const [aMaj, aMin = 0] = toNum(a);
      const [bMaj, bMin = 0] = toNum(b);
      return aMaj !== bMaj ? aMaj > bMaj : aMin > bMin;
    };

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'old-mod');

    expect(mod.issues).toContain('may be incompatible: declares max core 12.999, running 13.331');
  });

  it('flags "may be incompatible: declares min core X, running Y" when core is below min', async () => {
    world.addModule({
      id: 'future-mod',
      title: 'Future Mod',
      version: '2.0.0',
      active: true,
      compatibility: { minimum: '14.0' },
    });

    // isNewer(comp.minimum, coreVer) → isNewer('14.0','13.331')=true
    (globalThis as any).foundry.utils.isNewerVersion = (a: string, b: string): boolean => {
      const toNum = (v: string) => v.split('.').map(Number);
      const [aMaj, aMin = 0] = toNum(a);
      const [bMaj, bMin = 0] = toNum(b);
      return aMaj !== bMaj ? aMaj > bMaj : aMin > bMin;
    };

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'future-mod');

    expect(mod.issues).toContain('may be incompatible: declares min core 14.0, running 13.331');
  });

  it('does not push compatibility issues when isNewerVersion is absent (default harness)', async () => {
    world.addModule({
      id: 'any-mod',
      title: 'Any Mod',
      version: '1.0.0',
      active: true,
      compatibility: { minimum: '14.0', maximum: '12.0' },
    });

    // Default harness has no isNewerVersion → branches skipped
    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'any-mod');

    expect(mod.issues).toEqual([]);
  });
});

// =============================================================================
// getModules — activeOnly / withIssuesOnly filters + count invariants
// =============================================================================

describe('FoundryDataAccess — getModules filters and count invariants', () => {
  beforeEach(() => {
    // active module, no issues
    world.addModule({ id: 'active-clean', title: 'Active Clean', version: '1.0.0', active: true });
    // inactive module, no issues
    world.addModule({
      id: 'inactive-clean',
      title: 'Inactive Clean',
      version: '1.0.0',
      active: false,
    });
    // active module WITH an issue (missing dep)
    world.addModule({
      id: 'active-broken',
      title: 'Active Broken',
      version: '1.0.0',
      active: true,
      relationships: { requires: [{ id: 'not-installed' }] },
    });
  });

  it('activeOnly filters modules list to active only', async () => {
    const result = await da.getModules({ activeOnly: true });

    const ids = result.modules.map((m: any) => m.id);
    expect(ids).toContain('active-clean');
    expect(ids).toContain('active-broken');
    expect(ids).not.toContain('inactive-clean');
  });

  it('withIssuesOnly filters modules list to those with issues', async () => {
    const result = await da.getModules({ withIssuesOnly: true });

    const ids = result.modules.map((m: any) => m.id);
    expect(ids).toContain('active-broken');
    expect(ids).not.toContain('active-clean');
    expect(ids).not.toContain('inactive-clean');
  });

  it('moduleCount reflects the filtered list length, not the total', async () => {
    const activeResult = await da.getModules({ activeOnly: true });
    expect(activeResult.moduleCount).toBe(activeResult.modules.length);

    const issueResult = await da.getModules({ withIssuesOnly: true });
    expect(issueResult.moduleCount).toBe(issueResult.modules.length);
  });

  it('activeCount and modulesWithIssues always count over the FULL (unfiltered) set', async () => {
    const result = await da.getModules({ activeOnly: true });

    // activeCount = all active across the world (active-clean + active-broken = 2)
    expect(result.activeCount).toBe(2);
    // modulesWithIssues = all modules with issues across the world (active-broken = 1)
    expect(result.modulesWithIssues).toBe(1);
  });
});

// =============================================================================
// getModuleManifest
// =============================================================================

describe('FoundryDataAccess — getModuleManifest', () => {
  it('throws "Module not found: <id>" when the module does not exist', async () => {
    await expect(da.getModuleManifest({ moduleId: 'no-such-module' })).rejects.toThrow(
      'Module not found: no-such-module'
    );
  });

  it('returns success:true and a manifest with all fields for a known module', async () => {
    world.addModule({
      id: 'full-mod',
      title: 'Full Mod',
      version: '3.0.0',
      active: true,
      compatibility: { minimum: '12.0', verified: '13.0', maximum: '13.999' },
      relationships: { requires: [{ id: 'some-dep' }] },
      authors: [{ name: 'Alice', email: 'alice@example.com' }],
      description: 'A test module.',
      url: 'https://example.com/full-mod',
      flags: { 'full-mod': { someFlag: true } },
    });

    const result = await da.getModuleManifest({ moduleId: 'full-mod' });

    expect(result.success).toBe(true);
    expect(result.manifest).toMatchObject({
      id: 'full-mod',
      title: 'Full Mod',
      version: '3.0.0',
      active: true,
      description: 'A test module.',
      url: 'https://example.com/full-mod',
    });
  });

  it('passes compatibility through sanitizeData (JSON-safe deep copy)', async () => {
    world.addModule({
      id: 'compat-mod',
      title: 'Compat Mod',
      version: '1.0.0',
      active: true,
      compatibility: { minimum: '11.0', verified: '13.0', maximum: '13.999' },
    });

    const result = await da.getModuleManifest({ moduleId: 'compat-mod' });

    expect(result.manifest.compatibility).toEqual({
      minimum: '11.0',
      verified: '13.0',
      maximum: '13.999',
    });
  });

  it('passes authors through sanitizeData as a plain array', async () => {
    world.addModule({
      id: 'authored-mod',
      title: 'Authored Mod',
      version: '1.0.0',
      active: true,
      authors: [{ name: 'Bob' }, { name: 'Carol' }],
    });

    const result = await da.getModuleManifest({ moduleId: 'authored-mod' });

    expect(result.manifest.authors).toEqual([{ name: 'Bob' }, { name: 'Carol' }]);
  });

  it('sanitizes flags through sanitizeData, stripping _ prefixed keys', async () => {
    world.addModule({
      id: 'flagged-mod',
      title: 'Flagged Mod',
      version: '1.0.0',
      active: true,
      flags: { myns: { enabled: true, _internal: 'secret' } },
    });

    const result = await da.getModuleManifest({ moduleId: 'flagged-mod' });

    // sanitizeData strips keys starting with '_' (except '_id')
    expect(result.manifest.flags).toEqual({ myns: { enabled: true } });
  });
});
