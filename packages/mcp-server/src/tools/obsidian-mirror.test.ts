import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STORY_ITEM_TYPES, TOOL_REF_KEY, checkToolRefs } from '@gnuminator/shared';

import { classifyTool } from '../../../cogm-dashboard/src/tool-policy.js';
import { GuardedWriteService, type PlanInput, type PlanView } from '../guarded-write/service.js';
import { emptyMirrorStatus, type MirrorStatus } from '../obsidian/mirror-common.js';
import {
  DEFAULT_MIRROR_SETTINGS,
  MIRROR_FEATURE,
  MIRROR_SETTINGS_FILE,
  hashMirrorSettings,
  readMirrorSettings,
} from '../obsidian/mirror-settings.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { ObsidianMirrorTools, type ObsidianMirrorEnv } from './obsidian-mirror.js';

const WORLD = 'curse-of-strahd';
const ID_A = 'aaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbb';
const ID_C = 'cccccccccccccccc';

function makeLogger(): any {
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  return logger;
}

let dataDir: string;
let store: VaultStore;
const worldIds = { current: (): Promise<string> => Promise.resolve(WORLD) };

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obsidian-mirror-tool-'));
  store = new VaultStore({ dataDir });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

async function saveSettings(settings: unknown): Promise<void> {
  await store.write(WORLD, 'gm', MIRROR_SETTINGS_FILE, { settings });
}

function planView(input: PlanInput): PlanView {
  return {
    planId: 'plan-1',
    feature: input.feature,
    summary: input.summary,
    target: 'vault',
    risk: 'write',
    worldId: WORLD,
    createdAt: '2026-09-29T00:00:00.000Z',
    expiresAt: '2026-09-29T00:15:00.000Z',
    diff: [],
    requires: { confirm: true, confirmDestructive: false },
  };
}

interface FakeSetup {
  tools: ObsidianMirrorTools;
  createPlan: ReturnType<typeof vi.fn>;
  logger: any;
}

function setup(
  options: { env?: ObsidianMirrorEnv; status?: () => MirrorStatus | null } = {}
): FakeSetup {
  const logger = makeLogger();
  const createPlan = vi.fn((input: PlanInput) => Promise.resolve(planView(input)));
  const tools = new ObsidianMirrorTools({
    store,
    worldIds,
    guardedWrites: { createPlan },
    status: options.status ?? ((): null => null),
    ...(options.env ? { env: options.env } : {}),
    logger,
  });
  return { tools, createPlan, logger };
}

/** The plan input `plan-obsidian-mirror` passed to `createPlan`. */
function planned(createPlan: ReturnType<typeof vi.fn>): PlanInput {
  expect(createPlan).toHaveBeenCalledTimes(1);
  return (createPlan.mock.calls[0] as [PlanInput])[0];
}

describe('tool definitions', () => {
  const tools = new ObsidianMirrorTools({
    store: {} as any,
    worldIds: {} as any,
    guardedWrites: {} as any,
    status: (): null => null,
    logger: makeLogger(),
  });
  const definitions = tools.getToolDefinitions();
  const byName = Object.fromEntries(definitions.map(d => [d.name, d]));

  it('offers exactly get-obsidian-mirror and plan-obsidian-mirror', () => {
    expect(definitions.map(d => d.name)).toEqual(['get-obsidian-mirror', 'plan-obsidian-mirror']);
  });

  it('classifies both as reads in the dashboard tool policy (no GM Actions switch, no confirm)', () => {
    expect(classifyTool('get-obsidian-mirror')).toBe('read');
    expect(classifyTool('plan-obsidian-mirror')).toBe('read');
  });

  it('get-obsidian-mirror takes no arguments and explains when the mirror writes', () => {
    const def = byName['get-obsidian-mirror'];
    expect(def.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(def.description).toContain('FOUNDRY_AI_OBSIDIAN_DIR');
    expect(def.description).toContain('settings.enabled');
    expect(def.description).toContain('plan-obsidian-mirror');
  });

  it('plan-obsidian-mirror describes the guarded flow and every argument is optional', () => {
    const def = byName['plan-obsidian-mirror'];
    expect(def.description).toContain('apply-planned-change');
    expect(def.description).toContain('undo-change');
    expect(Object.keys(def.inputSchema.properties)).toEqual([
      'enabled',
      'kinds',
      'textFolderIds',
      'textJournalIds',
      'excludeFolderIds',
      'storyItemTypes',
      'libraryPacks',
    ]);
    expect(def.inputSchema.required).toBeUndefined();
  });

  it('carries pickers on the three id lists, with the journal filter on text folders', () => {
    const props = byName['plan-obsidian-mirror'].inputSchema.properties as Record<
      string,
      Record<string, any>
    >;
    expect(props.textFolderIds[TOOL_REF_KEY]).toEqual({
      kind: 'folder',
      value: 'id',
      filter: { documentName: 'JournalEntry' },
    });
    expect(props.textJournalIds[TOOL_REF_KEY]).toEqual({ kind: 'journal', value: 'id' });
    expect(props.excludeFolderIds[TOOL_REF_KEY]).toEqual({ kind: 'folder', value: 'id' });
    expect(props.enabled[TOOL_REF_KEY]).toBeUndefined();
    expect(props.kinds[TOOL_REF_KEY]).toBeUndefined();
    expect(props.storyItemTypes[TOOL_REF_KEY]).toBeUndefined();
  });

  it('has no annotation problems and offers the kinds as an enum', () => {
    for (const def of definitions) expect(checkToolRefs(def)).toEqual([]);
    const props = byName['plan-obsidian-mirror'].inputSchema.properties as Record<string, any>;
    expect(props.kinds.items.enum).toEqual(['pc', 'npc', 'scene', 'journal', 'item']);
  });
});

describe('get-obsidian-mirror', () => {
  it('returns the defaults, their hash, the environment and a null status', async () => {
    const { tools } = setup({
      env: { vaultDirSet: true, openBase: 'http://localhost:3100', pollMs: 6000 },
    });
    expect(await tools.handleGetObsidianMirror({})).toEqual({
      settings: DEFAULT_MIRROR_SETTINGS,
      hash: hashMirrorSettings(DEFAULT_MIRROR_SETTINGS),
      vaultDirSet: true,
      openBase: 'http://localhost:3100',
      pollMs: 6000,
      foundryUrlSet: false,
      foundryUrl: null,
      status: null,
    });
  });

  it('reports FOUNDRY_AI_FOUNDRY_URL (not a secret) when it is set', async () => {
    const { tools } = setup({
      env: {
        vaultDirSet: true,
        openBase: 'http://localhost:3100',
        pollMs: 6000,
        foundryUrl: 'http://foundry.internal:30000/game',
      },
    });
    expect(await tools.handleGetObsidianMirror({})).toMatchObject({
      foundryUrlSet: true,
      foundryUrl: 'http://foundry.internal:30000/game',
    });
  });

  it('without an env assumes no vault dir and the defaults', async () => {
    const { tools } = setup();
    expect(await tools.handleGetObsidianMirror(undefined)).toMatchObject({
      vaultDirSet: false,
      openBase: 'http://localhost:3000',
      pollMs: 10_000,
    });
  });

  it('returns the saved settings, normalized, with their hash', async () => {
    await saveSettings({
      enabled: true,
      kinds: ['npc', 'pc', 'wrong'],
      text: { folderIds: [ID_B, 'bad'], journalIds: [ID_A] },
      excludeFolderIds: [ID_C],
      storyItemTypes: ['loot'],
    });
    const { tools } = setup();
    const view = await tools.handleGetObsidianMirror({});
    expect(view.settings).toEqual({
      schema: 1,
      enabled: true,
      kinds: ['pc', 'npc'],
      text: { folderIds: [ID_B], journalIds: [ID_A] },
      excludeFolderIds: [ID_C],
      storyItemTypes: ['loot'],
      libraryPacks: [],
    });
    expect(view.hash).toBe(hashMirrorSettings(view.settings));
    expect(view.hash).not.toBe(hashMirrorSettings(DEFAULT_MIRROR_SETTINGS));
  });

  it('returns the pump status as the provider reports it, read fresh on every call', async () => {
    let status: MirrorStatus | null = null;
    const { tools } = setup({ status: () => status });
    expect((await tools.handleGetObsidianMirror({})).status).toBeNull();
    status = emptyMirrorStatus({
      enabled: true,
      vaultDirSet: true,
      worldId: WORLD,
      openBase: 'http://localhost:3000',
    });
    status.counts.npc = 4;
    status.skipped.push({ path: 'AI Tool/Foundry/NPCs/Wolf.md', reason: 'edited by the GM' });
    const view = await tools.handleGetObsidianMirror({});
    expect(view.status?.counts.npc).toBe(4);
    expect(view.status?.skipped).toEqual([
      { path: 'AI Tool/Foundry/NPCs/Wolf.md', reason: 'edited by the GM' },
    ]);
  });

  it('does not write anything', async () => {
    const { tools, createPlan } = setup();
    await tools.handleGetObsidianMirror({});
    expect(createPlan).not.toHaveBeenCalled();
    expect(await store.read(WORLD, 'gm', MIRROR_SETTINGS_FILE)).toBeNull();
  });

  it('reports a corrupt settings file instead of hiding it', async () => {
    const file = store.filePath(WORLD, 'gm', MIRROR_SETTINGS_FILE);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{ nope', 'utf8');
    const { tools } = setup();
    await expect(tools.handleGetObsidianMirror({})).rejects.toThrow();
  });
});

describe('plan-obsidian-mirror (fake guarded writes)', () => {
  it('plans one vault-set of the full new settings under the obsidian-mirror feature', async () => {
    const { tools, createPlan } = setup({
      env: { vaultDirSet: true, openBase: 'http://localhost:3000', pollMs: 10_000 },
    });
    const view = await tools.handlePlanObsidianMirror({ enabled: true });
    const input = planned(createPlan);
    expect(input.feature).toBe(MIRROR_FEATURE);
    expect(input.feature).toBe('obsidian-mirror');
    expect(input.ops).toBeUndefined();
    expect(input.risk).toBeUndefined();
    expect(input.vaultOps).toEqual([
      {
        kind: 'vault-set',
        file: 'obsidian-mirror.json',
        path: 'settings',
        value: { ...DEFAULT_MIRROR_SETTINGS, enabled: true },
      },
    ]);
    expect(view.planId).toBe('plan-1');
    expect(view.risk).toBe('write');
    expect(view.warnings).toBeUndefined();
  });

  it('names what changes in a readable summary', async () => {
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({ enabled: true });
    expect(planned(createPlan).summary).toBe('Obsidian mirror settings: switch the mirror ON');
  });

  it('changes only the given fields and keeps the rest of the saved settings', async () => {
    await saveSettings({
      enabled: true,
      kinds: ['pc', 'npc'],
      text: { folderIds: [ID_A], journalIds: [ID_B] },
      excludeFolderIds: [ID_C],
      storyItemTypes: ['loot', 'weapon'],
    });
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({ textJournalIds: [ID_A, ID_C] });
    const value = planned(createPlan).vaultOps![0] as { value: unknown };
    expect(value.value).toEqual({
      schema: 1,
      enabled: true,
      kinds: ['pc', 'npc'],
      text: { folderIds: [ID_A], journalIds: [ID_A, ID_C] },
      excludeFolderIds: [ID_C],
      storyItemTypes: ['loot', 'weapon'],
      libraryPacks: [],
    });
  });

  it.each([
    ['enabled', { enabled: true }],
    ['kinds', { kinds: ['scene', 'pc'] }],
    ['textFolderIds', { textFolderIds: [ID_A] }],
    ['textJournalIds', { textJournalIds: [ID_A] }],
    ['excludeFolderIds', { excludeFolderIds: [ID_A] }],
    ['storyItemTypes', { storyItemTypes: ['loot'] }],
  ])('changing only %s leaves every other field at its default', async (_name, args) => {
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror(args);
    const next = (planned(createPlan).vaultOps![0] as { value: any }).value;
    const expected: any = JSON.parse(JSON.stringify(DEFAULT_MIRROR_SETTINGS));
    if ('enabled' in args) expected.enabled = true;
    if ('kinds' in args) expected.kinds = ['pc', 'scene'];
    if ('textFolderIds' in args) expected.text.folderIds = [ID_A];
    if ('textJournalIds' in args) expected.text.journalIds = [ID_A];
    if ('excludeFolderIds' in args) expected.excludeFolderIds = [ID_A];
    if ('storyItemTypes' in args) expected.storyItemTypes = ['loot'];
    expect(next).toEqual(expected);
  });

  it('normalizes the arguments: deduplicated, sorted ids, kinds in the fixed order', async () => {
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({
      kinds: ['item', 'pc', 'item'],
      excludeFolderIds: [ID_C, ID_A, ID_C],
    });
    const next = (planned(createPlan).vaultOps![0] as { value: any }).value;
    expect(next.kinds).toEqual(['pc', 'item']);
    expect(next.excludeFolderIds).toEqual([ID_A, ID_C]);
  });

  it('accepts an empty kinds list (mirror nothing) and empty lists to clear a setting', async () => {
    await saveSettings({ excludeFolderIds: [ID_A], text: { folderIds: [ID_B], journalIds: [] } });
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({
      kinds: [],
      excludeFolderIds: [],
      textFolderIds: [],
      storyItemTypes: [],
    });
    const input = planned(createPlan);
    const next = (input.vaultOps![0] as { value: any }).value;
    expect(next.kinds).toEqual([]);
    expect(next.excludeFolderIds).toEqual([]);
    expect(next.text.folderIds).toEqual([]);
    expect(next.storyItemTypes).toEqual([]);
    expect(input.summary).toContain('mirrored kinds: none (was pc, npc, scene, journal, item)');
    expect(input.summary).toContain(`excluded folders: remove ${ID_A} (now 0)`);
    expect(input.summary).toContain(`page text folders: remove ${ID_B} (now 0)`);
    expect(input.summary).toContain('story item types: remove');
  });

  it('summarizes list changes with added and removed ids, counts and the kinds', async () => {
    await saveSettings({
      enabled: true,
      text: { folderIds: [ID_A], journalIds: [] },
      excludeFolderIds: [ID_B],
    });
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({
      enabled: false,
      kinds: ['pc', 'npc'],
      textFolderIds: [ID_C],
      textJournalIds: [ID_A],
      storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES, 'spell'],
    });
    const { summary } = planned(createPlan);
    expect(summary).toContain('switch the mirror OFF');
    expect(summary).toContain('mirrored kinds: pc, npc (was pc, npc, scene, journal, item)');
    expect(summary).toContain(`page text folders: add ${ID_C} and remove ${ID_A} (now 1)`);
    expect(summary).toContain(`page text journals: add ${ID_A} (now 1)`);
    expect(summary).toContain('story item types: add spell (now 7)');
    expect(summary).not.toContain('excluded folders');
  });

  it('shortens a long list to the first few ids and a count', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `id${String(i).padStart(14, '0')}`);
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({ excludeFolderIds: ids });
    const { summary } = planned(createPlan);
    expect(summary).toContain(`${ids.slice(0, 5).join(', ')} and 4 more (now 9)`);
    expect(summary).not.toContain(ids[8]);
  });

  it('says so when only the order of the story item types changes', async () => {
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({
      storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES].reverse(),
    });
    expect(planned(createPlan).summary).toBe(
      'Obsidian mirror settings: story item types: reordered'
    );
  });

  describe('nothing to change', () => {
    it.each([
      ['no arguments', {}],
      ['an empty object', undefined],
      ['null', null],
      ['enabled already false', { enabled: false }],
      ['the default kinds in another order', { kinds: ['item', 'journal', 'scene', 'npc', 'pc'] }],
      ['an empty id list on empty lists', { excludeFolderIds: [], textFolderIds: [] }],
      ['the default story item types', { storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES] }],
    ])('refuses %s', async (_name, args) => {
      const { tools, createPlan, logger } = setup();
      await expect(tools.handlePlanObsidianMirror(args)).rejects.toThrow(/nothing to change/i);
      expect(createPlan).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('refuses repeating the saved settings, duplicates and order aside', async () => {
      await saveSettings({ enabled: true, excludeFolderIds: [ID_A, ID_B] });
      const { tools, createPlan } = setup();
      await expect(
        tools.handlePlanObsidianMirror({ enabled: true, excludeFolderIds: [ID_B, ID_A, ID_B] })
      ).rejects.toThrow(/nothing to change/i);
      expect(createPlan).not.toHaveBeenCalled();
    });
  });

  describe('argument validation', () => {
    it.each([
      ['a non-boolean enabled', { enabled: 'true' }],
      ['an unknown kind', { kinds: ['pc', 'monster'] }],
      ['kinds that is not a list', { kinds: 'pc' }],
      ['an invalid folder id', { textFolderIds: ['not-an-id'] }],
      ['an id with a path in it', { excludeFolderIds: ['../../aaaaaaaaaa'] }],
      ['a journal id that is a number', { textJournalIds: [5] }],
      ['more than 200 ids', { excludeFolderIds: Array.from({ length: 201 }, () => ID_A) }],
      ['an invalid item type', { storyItemTypes: ['Bad Type'] }],
      [
        'more than 30 item types',
        { storyItemTypes: Array.from({ length: 31 }, (_, i) => `t${i}`) },
      ],
      ['an unknown argument', { enable: true }],
      ['arguments that are not an object', 'enabled'],
    ])('rejects %s and creates no plan', async (_name, args) => {
      const { tools, createPlan } = setup();
      await expect(tools.handlePlanObsidianMirror(args)).rejects.toThrow();
      expect(createPlan).not.toHaveBeenCalled();
    });

    it('names the bad value class in the error, not silently dropping it', async () => {
      const { tools } = setup();
      await expect(
        tools.handlePlanObsidianMirror({ textFolderIds: [ID_A, 'nope'] })
      ).rejects.toThrow(/textFolderIds/);
      await expect(tools.handlePlanObsidianMirror({ kinds: ['pc', 'monster'] })).rejects.toThrow(
        /kinds must be from/
      );
    });
  });

  describe('warnings', () => {
    it('warns when enabling while FOUNDRY_AI_OBSIDIAN_DIR is not set', async () => {
      const { tools } = setup({
        env: { vaultDirSet: false, openBase: 'http://localhost:3000', pollMs: 10_000 },
      });
      const view = await tools.handlePlanObsidianMirror({ enabled: true });
      expect(view.warnings).toHaveLength(1);
      expect(view.warnings![0]).toContain('FOUNDRY_AI_OBSIDIAN_DIR');
    });

    it('does not warn when the directory is set, or when the mirror stays off or is switched off', async () => {
      const withDir = setup({
        env: { vaultDirSet: true, openBase: 'http://localhost:3000', pollMs: 10_000 },
      });
      expect(
        (await withDir.tools.handlePlanObsidianMirror({ enabled: true })).warnings
      ).toBeUndefined();

      await saveSettings({ enabled: true });
      const off = setup();
      expect(
        (await off.tools.handlePlanObsidianMirror({ enabled: false })).warnings
      ).toBeUndefined();
    });
  });

  it('passes a failure of the guarded-write service on, and logs it', async () => {
    const logger = makeLogger();
    const tools = new ObsidianMirrorTools({
      store,
      worldIds,
      guardedWrites: {
        createPlan: (): Promise<PlanView> => Promise.reject(new Error('Foundry not connected')),
      },
      status: (): null => null,
      logger,
    });
    await expect(tools.handlePlanObsidianMirror({ enabled: true })).rejects.toThrow(
      'Foundry not connected'
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Obsidian mirror plan not created',
      expect.objectContaining({ error: 'Foundry not connected' })
    );
  });

  it('never puts anything but ids, types and counts in the summary', async () => {
    const { tools, createPlan } = setup();
    await tools.handlePlanObsidianMirror({
      enabled: true,
      textJournalIds: [ID_A],
      excludeFolderIds: [ID_B],
      storyItemTypes: ['loot'],
    });
    expect(planned(createPlan).summary).toMatch(/^[A-Za-z0-9 ,:;()_-]+$/);
  });
});

describe('plan-obsidian-mirror end to end (real GuardedWriteService)', () => {
  let foundry: FakeFoundry;
  let guarded: GuardedWriteService;
  let tools: ObsidianMirrorTools;
  let now: number;

  beforeEach(() => {
    foundry = new FakeFoundry();
    foundry.worldId = WORLD;
    foundry.features = [
      { id: MIRROR_FEATURE, name: 'AI Tool: Obsidian mirror (writes)', hint: '', enabled: true },
    ];
    now = Date.parse('2026-09-29T09:00:00.000Z');
    const logger = makeLogger();
    guarded = new GuardedWriteService({
      foundryClient: foundry,
      worldIds,
      store,
      audit: new AuditLog(store),
      logger,
      now: (): number => now,
    });
    tools = new ObsidianMirrorTools({
      store,
      worldIds,
      guardedWrites: guarded,
      status: (): null => null,
      env: { vaultDirSet: true, openBase: 'http://localhost:3000', pollMs: 10_000 },
      logger,
    });
  });

  async function storedSettings(): Promise<any> {
    return (await store.read<any>(WORLD, 'gm', MIRROR_SETTINGS_FILE))?.data?.settings;
  }

  it('plans a vault-only, non-destructive change that shows the settings diff', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    expect(plan.feature).toBe('obsidian-mirror');
    expect(plan.target).toBe('vault');
    expect(plan.risk).toBe('write');
    expect(plan.requires).toEqual({ confirm: true, confirmDestructive: false });
    expect(plan.summary).toBe('Obsidian mirror settings: switch the mirror ON');
    expect(plan.diff).toHaveLength(1);
    expect(plan.diff[0]).toMatchObject({ target: `gm/${MIRROR_SETTINGS_FILE}`, path: 'settings' });
    // Planning writes nothing.
    expect(await store.read(WORLD, 'gm', MIRROR_SETTINGS_FILE)).toBeNull();
    expect(foundry.calls.map(([method]) => method)).not.toContain(
      'foundry-mcp-bridge.applyGuardedOps'
    );
  });

  it('apply with the feature on writes the settings file and the tools read it back', async () => {
    const before = await tools.handleGetObsidianMirror({});
    expect(before.settings.enabled).toBe(false);

    const plan = await tools.handlePlanObsidianMirror({
      enabled: true,
      textJournalIds: [ID_A],
      excludeFolderIds: [ID_C, ID_B],
    });
    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    expect(applied.feature).toBe('obsidian-mirror');
    expect(applied.target).toBe('vault');

    const saved = await storedSettings();
    expect(saved).toEqual({
      schema: 1,
      enabled: true,
      kinds: ['pc', 'npc', 'scene', 'journal', 'item'],
      text: { folderIds: [], journalIds: [ID_A] },
      excludeFolderIds: [ID_B, ID_C],
      storyItemTypes: [...DEFAULT_STORY_ITEM_TYPES],
      libraryPacks: [],
    });

    const after = await tools.handleGetObsidianMirror({});
    expect(after.settings).toEqual(saved);
    expect(after.hash).not.toBe(before.hash);
    const read = await readMirrorSettings(store, WORLD);
    expect(read.hash).toBe(after.hash);
  });

  it('apply with the feature switched off is refused and nothing is written', async () => {
    foundry.features = [
      { id: MIRROR_FEATURE, name: 'AI Tool: Obsidian mirror (writes)', hint: '', enabled: false },
    ];
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    await expect(guarded.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(
      /obsidian-mirror.*switched off/
    );
    expect(await store.read(WORLD, 'gm', MIRROR_SETTINGS_FILE)).toBeNull();
    expect((await tools.handleGetObsidianMirror({})).settings.enabled).toBe(false);
  });

  it('apply is refused when the module has no such feature (older module)', async () => {
    foundry.features = [];
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    await expect(guarded.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(
      /Unknown feature "obsidian-mirror"/
    );
    expect(await store.read(WORLD, 'gm', MIRROR_SETTINGS_FILE)).toBeNull();
  });

  it('apply is refused without confirm', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    await expect(guarded.applyPlan(plan.planId, {})).rejects.toThrow(/confirm/);
    expect(await store.read(WORLD, 'gm', MIRROR_SETTINGS_FILE)).toBeNull();
  });

  it('undo restores the defaults after the first change', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    expect((await readMirrorSettings(store, WORLD)).settings.enabled).toBe(true);

    const undone = await guarded.undo(applied.changeId, { confirm: true });
    expect(undone.mode).toBe('undo');
    const restored = await readMirrorSettings(store, WORLD);
    expect(restored.settings).toEqual(DEFAULT_MIRROR_SETTINGS);
    expect(restored.hash).toBe(hashMirrorSettings(DEFAULT_MIRROR_SETTINGS));
  });

  it('undo restores the previous non-default settings after a later change', async () => {
    const first = await tools.handlePlanObsidianMirror({
      enabled: true,
      kinds: ['pc', 'npc'],
    });
    await guarded.applyPlan(first.planId, { confirm: true });
    const savedFirst = await storedSettings();

    const second = await tools.handlePlanObsidianMirror({ excludeFolderIds: [ID_A] });
    // The second plan starts from the applied first one.
    expect(second.summary).toBe(`Obsidian mirror settings: excluded folders: add ${ID_A} (now 1)`);
    const appliedSecond = await guarded.applyPlan(second.planId, { confirm: true });
    expect((await storedSettings()).excludeFolderIds).toEqual([ID_A]);

    await guarded.undo(appliedSecond.changeId, { confirm: true });
    expect(await storedSettings()).toEqual(savedFirst);
    expect((await readMirrorSettings(store, WORLD)).settings.kinds).toEqual(['pc', 'npc']);
  });

  it('undo works while the feature switch is off (undo never needs it)', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    foundry.features = [
      { id: MIRROR_FEATURE, name: 'AI Tool: Obsidian mirror (writes)', hint: '', enabled: false },
    ];
    await guarded.undo(applied.changeId, { confirm: true });
    expect((await readMirrorSettings(store, WORLD)).settings.enabled).toBe(false);
  });

  it('a plan for the state that is already in force is refused', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    await guarded.applyPlan(plan.planId, { confirm: true });
    await expect(tools.handlePlanObsidianMirror({ enabled: true })).rejects.toThrow(
      /nothing to change/i
    );
  });

  it('a settings file edited between plan and apply is a conflict and nothing is written', async () => {
    const plan = await tools.handlePlanObsidianMirror({ enabled: true });
    await saveSettings({ enabled: false, excludeFolderIds: [ID_A] });
    await expect(guarded.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(/Conflict/);
    expect(await storedSettings()).toEqual({ enabled: false, excludeFolderIds: [ID_A] });
  });

  it('shows up in the recent changes so the GM can undo it later', async () => {
    const plan = await tools.handlePlanObsidianMirror({ kinds: ['pc'] });
    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    const recent = await guarded.listRecentChanges();
    expect(recent[0]).toMatchObject({
      changeId: applied.changeId,
      feature: 'obsidian-mirror',
      canUndo: true,
    });
  });
});
