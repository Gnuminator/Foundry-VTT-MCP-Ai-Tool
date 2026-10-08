import type {
  PreflightChecksResult,
  PreflightModuleFinding,
  PreflightScan,
  PreflightScanResult,
  PreflightSettingFinding,
} from '@gnuminator/shared';
import { describe, expect, it, vi } from 'vitest';

import { SecretTermsService } from '../secret-terms.js';
import { PreflightTools, type PreflightToolsOptions } from './preflight.js';

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

const SCAN: PreflightScan = {
  schema: 1,
  computedAt: 1000,
  settingsChecked: 42,
  settings: [],
  names: [
    { kind: 'playlist', id: 'p1', name: 'Tavern Music' },
    { kind: 'scene', id: 's1', name: 'Where the Sunsword lies' },
  ],
  modules: [],
};

interface Setup {
  connected?: boolean;
  moduleVersion?: string | null;
  scan?: PreflightScan | Error;
  features?: unknown;
  terms?: string[];
  open?: boolean;
  vaultDirSet?: boolean;
}

function tools(setup: Setup = {}): { tools: PreflightTools; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn((method: string): Promise<unknown> => {
    if (method === 'foundry-mcp-bridge.getPreflightScan') {
      if (setup.scan instanceof Error) return Promise.reject(setup.scan);
      return Promise.resolve(setup.scan ?? SCAN);
    }
    if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
      return Promise.resolve(
        setup.features ?? [
          { id: 'tarokka', name: 'Tarokka', hint: '', enabled: true, writesAllowed: true },
          { id: 'handouts', name: 'Handouts', hint: '', enabled: false, writesAllowed: true },
        ]
      );
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });
  const options: PreflightToolsOptions = {
    foundryClient: {
      query,
      isConnected: () => setup.connected ?? true,
      getConnectionInfo: () => ({
        userName: 'Claude',
        moduleVersion: setup.moduleVersion === undefined ? '1.2.3' : setup.moduleVersion,
      }),
    },
    secretTerms: new SecretTermsService({
      store: {} as never,
      sources: [{ category: 'tarokka-card', terms: () => Promise.resolve(setup.terms ?? []) }],
    }),
    worldIds: { current: () => Promise.resolve('world') },
    playSession: {
      handleGetPlaySession: () =>
        Promise.resolve({
          success: true,
          worldId: 'world',
          open: setup.open ?? false,
          startedAt: setup.open ? '2026-09-30T19:00:00.000Z' : null,
          lastEventAt: null,
        }) as never,
    },
    obsidianVaultDirSet: setup.vaultDirSet ?? true,
    logger: logger(),
    bridgeVersion: '1.2.3',
  };
  return { tools: new PreflightTools(options), query };
}

function byId(result: PreflightChecksResult): Record<string, { status: string; detail: string }> {
  return Object.fromEntries(result.checks.map(c => [c.id, c]));
}

describe('get-preflight', () => {
  it('is one read tool with an action parameter', () => {
    const defs = tools().tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-preflight']);
    expect(defs[0]?.inputSchema.properties).toHaveProperty('action');
  });

  it('checks: all clear is ready, with every check in a fixed order', async () => {
    const result = (await tools().tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(result.ready).toBe(true);
    expect(result.checks.map(c => c.id)).toEqual([
      'foundry-link',
      'versions',
      'write-switches',
      'world-settings',
      'visible-names',
      'modules',
      'obsidian',
      'play-session',
    ]);
    const c = byId(result);
    expect(c['foundry-link']?.status).toBe('ok');
    expect(c.versions?.status).toBe('ok');
    expect(c['write-switches']).toMatchObject({ status: 'info' });
    expect(c['write-switches']?.detail).toContain('Tarokka');
    expect(c['world-settings']?.detail).toContain('42 world settings');
    expect(c['play-session']?.status).toBe('info');
    expect(result.moduleVersion).toBe('1.2.3');
    expect(result.bridgeVersion).toBe('1.2.3');
  });

  it('fails on a version mismatch and names both versions', async () => {
    const result = (await tools({ moduleVersion: '1.2.0' }).tools.handleGetPreflight(
      {}
    )) as PreflightChecksResult;
    expect(result.ready).toBe(false);
    expect(byId(result).versions).toMatchObject({ status: 'fail' });
    expect(byId(result).versions?.detail).toContain('1.2.0');
    expect(byId(result).versions?.detail).toContain('1.2.3');
  });

  it('without Foundry: fails the link, leaves the module checks unknown and does not query', async () => {
    const { tools: t, query } = tools({ connected: false });
    const result = (await t.handleGetPreflight({ action: 'checks' })) as PreflightChecksResult;
    expect(result.ready).toBe(false);
    const c = byId(result);
    expect(c['foundry-link']?.status).toBe('fail');
    expect(c.versions?.status).toBe('unknown');
    expect(c['world-settings']?.status).toBe('unknown');
    expect(result.scan).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('fails when a name players can see matches a secret term', async () => {
    const result = (await tools({ terms: ['Sunsword'] }).tools.handleGetPreflight(
      {}
    )) as PreflightChecksResult;
    expect(result.ready).toBe(false);
    expect(byId(result)['visible-names']).toMatchObject({ status: 'fail' });
    expect(result.scan?.names).toEqual([
      { kind: 'scene', id: 's1', name: 'Where the Sunsword lies', terms: ['Sunsword'] },
    ]);
  });

  it('fails on a secret in world settings and warns on a possible one', async () => {
    const setting = (severity: 'fail' | 'warn', key: string): PreflightSettingFinding => ({
      setting: key,
      namespace: 'x',
      rule: 'r',
      severity,
      reason: 'why',
      masked: '… (20 characters)',
    });
    const fail = (await tools({
      scan: { ...SCAN, settings: [setting('fail', 'x.hook'), setting('warn', 'x.apiToken')] },
    }).tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(byId(fail)['world-settings']).toMatchObject({ status: 'fail' });
    const warn = (await tools({
      scan: { ...SCAN, settings: [setting('warn', 'x.apiToken')] },
    }).tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(warn.ready).toBe(true);
    expect(byId(warn)['world-settings']).toMatchObject({ status: 'warn' });
  });

  it('warns on module conflicts, and only informs about a missing recommended module', async () => {
    const module = (severity: 'warn' | 'info'): PreflightModuleFinding => ({
      moduleId: 'm',
      title: 'Mod',
      rule: 'r',
      severity,
      reason: 'because.',
    });
    const warn = (await tools({
      scan: { ...SCAN, modules: [module('warn')] },
    }).tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(byId(warn).modules?.status).toBe('warn');
    const info = (await tools({
      scan: { ...SCAN, modules: [module('info')] },
    }).tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(byId(info).modules?.status).toBe('info');
  });

  it('a failed scan leaves its three checks unknown instead of failing the whole call', async () => {
    const result = (await tools({ scan: new Error('boom') }).tools.handleGetPreflight(
      {}
    )) as PreflightChecksResult;
    const c = byId(result);
    expect(c['world-settings']?.status).toBe('unknown');
    expect(c['world-settings']?.detail).toContain('boom');
    expect(c['write-switches']?.status).toBe('info');
    expect(result.scan).toBeNull();
  });

  it('reports "Allow Write Operations" off', async () => {
    const result = (await tools({
      features: [{ id: 'tarokka', name: 'Tarokka', hint: '', enabled: true, writesAllowed: false }],
    }).tools.handleGetPreflight({})) as PreflightChecksResult;
    expect(byId(result)['write-switches']?.detail).toContain('is off');
  });

  it('play session open and Obsidian unset', async () => {
    const result = (await tools({ open: true, vaultDirSet: false }).tools.handleGetPreflight(
      {}
    )) as PreflightChecksResult;
    expect(byId(result)['play-session']).toMatchObject({ status: 'ok' });
    expect(byId(result).obsidian).toMatchObject({ status: 'info' });
  });

  it('scan: returns the findings and only the names that match', async () => {
    const result = (await tools({ terms: ['Tavern'] }).tools.handleGetPreflight({
      action: 'scan',
    })) as PreflightScanResult;
    expect(result.namesChecked).toBe(2);
    expect(result.settingsChecked).toBe(42);
    expect(result.names.map(n => n.name)).toEqual(['Tavern Music']);
  });

  it('rejects an unknown action', async () => {
    await expect(tools().tools.handleGetPreflight({ action: 'fix' })).rejects.toThrow();
  });
});
