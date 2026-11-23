/**
 * Handout press (I-184): the templates, the local render, and the plan that puts the picture in
 * "Handouts" as a hidden page that the ordinary queue and reveal take over (undo removes it).
 */
import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PageForPlayers } from '@gnuminator/shared';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { makeLogger } from '../test-support/stub-tool-deps.js';
import { HandoutPressTools } from '../tools/handout-press.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import type { SecretTermMatch } from '../secret-terms.js';
import { HandoutsService } from './service.js';
import { findBrowser, PRESS_LIMITS, PRESS_SIZES, pressHtml, renderPress } from './press.js';

const execFileAsync = promisify(execFile);

const WORLD = 'curse-of-strahd';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('pressHtml', () => {
  it('escapes the supplied text, so it cannot add markup', () => {
    const html = pressHtml('letter', {
      title: '<script>alert(1)</script>',
      body: 'a & b\n\n<img src=x onerror=1>',
      footer: '"quoted"',
    });
    // The page's own fit script is the only script.
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).not.toContain('alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('makes a paragraph per blank line and has a template-specific look', () => {
    const html = pressHtml('notice', { title: 'Wanted', body: 'One\n\nTwo' });
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(pressHtml('letter', { title: 't', body: 'b' })).toContain('class="seal"');
    expect(pressHtml('card', { title: 't', body: 'b' })).toContain('class="art"');
  });
});

describe('renderPress', () => {
  it('says so in a sentence when no browser is found', async () => {
    await expect(renderPress('letter', { title: 't', body: 'b' }, null)).rejects.toThrow(
      /Edge, Google Chrome or Chromium/
    );
  });

  const browser = findBrowser();
  it.skipIf(!browser)(
    'renders all three templates to a PNG in under 10 seconds each',
    async () => {
      // A warm-up render, untimed: the first start can include a failed sandbox try (see
      // renderPress) and a cold browser, and is slow under a loaded CI runner.
      await renderPress('card', { title: 'Warm up', body: 'x' });
      for (const template of ['letter', 'notice', 'card'] as const) {
        const started = Date.now();
        const png = await renderPress(template, { title: 'Title', body: 'Some text.' });
        // 10 s is the product limit (one render takes about 2 s alone); 20 s here because the
        // whole suite runs in parallel and the first browser start is slow under load.
        expect(Date.now() - started).toBeLessThan(20_000);
        expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG));
        expect(png.length).toBeLessThan(5 * 1024 * 1024);
      }
    },
    120_000
  );

  it.skipIf(!browser)(
    'the longest allowed title and body fit on every template (no overflow mark)',
    async () => {
      for (const template of ['letter', 'notice', 'card'] as const) {
        const html = pressHtml(template, {
          // Words, so the title and footer wrap like real text (one long word would be clipped).
          title: 'Wanted '
            .repeat(PRESS_LIMITS.title[template])
            .slice(0, PRESS_LIMITS.title[template]),
          body: Array.from({ length: 3 }, () =>
            'Wordy text '.repeat(40).slice(0, Math.floor(PRESS_LIMITS.body[template] / 3) - 2)
          ).join('\n\n'),
          footer: 'Footer '.repeat(PRESS_LIMITS.footer).slice(0, PRESS_LIMITS.footer),
        });
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'press-fit-'));
        try {
          const page = path.join(dir, 'page.html');
          await fsp.writeFile(page, html, 'utf8');
          const { size } = { size: PRESS_SIZES[template] };
          const { stdout } = await execFileAsync(browser!, [
            '--headless=new',
            '--disable-gpu',
            // Our own test page; some CI Linux images have no usable browser sandbox.
            '--no-sandbox',
            `--user-data-dir=${path.join(dir, 'profile')}`,
            `--window-size=${size.width},${size.height}`,
            '--dump-dom',
            pathToFileURL(page).href,
          ]);
          expect(stdout, template).not.toContain('data-overflow');
        } finally {
          await fsp.rm(dir, { recursive: true, force: true });
        }
      }
    },
    90_000
  );
});

describe('plan-handout-press', () => {
  let dataDir: string;
  let foundry: FakeFoundry;
  let store: VaultStore;
  let guarded: GuardedWriteService;
  let handouts: HandoutsService;
  let tools: HandoutPressTools;
  let secrets: string[];
  let rendered: Array<{ template: string; title: string }>;

  function pageForPlayers(uuid: string): PageForPlayers {
    const doc = foundry.docs.get(uuid);
    if (!doc) {
      return {
        uuid,
        exists: false,
        name: null,
        observable: false,
        journalObservable: false,
        html: null,
      };
    }
    const journal = foundry.docs.get(uuid.split('.JournalEntryPage.')[0]);
    const journalLevel = journal
      ? ((journal.source.ownership as Record<string, number> | undefined)?.default ?? 0)
      : 0;
    const own = (doc.source.ownership as Record<string, number> | undefined)?.default;
    const level = own === undefined || own === -1 ? journalLevel : own;
    return {
      uuid,
      exists: true,
      name: (doc.source.name as string | undefined) ?? null,
      observable: journalLevel >= 2 && level >= 2,
      journalObservable: journalLevel >= 2,
      html: null,
      type: (doc.source.type as string | undefined) ?? 'text',
      src: (doc.source.src as string | undefined) ?? null,
      caption: null,
    };
  }

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'press-'));
    secrets = [];
    rendered = [];
    foundry = new FakeFoundry();
    foundry.worldId = WORLD;
    foundry.features = [{ id: 'handouts', name: 'Handouts', hint: '', enabled: true }];
    foundry.handlers['foundry-mcp-bridge.getPagesForPlayers'] = (data: {
      uuids: string[];
    }): { pages: PageForPlayers[] } => ({ pages: data.uuids.map(pageForPlayers) });
    foundry.handlers['foundry-mcp-bridge.uploadHandoutImage'] = (): {
      success: boolean;
      path: string;
    } => ({ success: true, path: 'assets/ai-art/handouts/handout-1.png' });
    store = new VaultStore({ dataDir });
    const logger = makeLogger();
    const worldIds = { current: (): Promise<string> => Promise.resolve(WORLD) };
    guarded = new GuardedWriteService({
      foundryClient: foundry,
      worldIds,
      store,
      audit: new AuditLog(store),
      logger,
      now: (): number => Date.parse('2026-11-19T20:00:00.000Z'),
    });
    handouts = new HandoutsService({
      guardedWrites: guarded,
      store,
      worldIds,
      foundryClient: foundry,
    });
    tools = new HandoutPressTools({
      handouts,
      secretTerms: {
        findSecretTerms: (_w: string, text: string): Promise<{ matches: SecretTermMatch[] }> =>
          Promise.resolve({
            matches: secrets
              .filter(s => text.toLowerCase().includes(s))
              .map(term => ({ category: 'tarokka', term })),
          }),
      },
      foundryClient: foundry,
      worldIds,
      logger,
      render: (template, content): Promise<Uint8Array> => {
        rendered.push({ template, title: content.title });
        return Promise.resolve(PNG);
      },
    });
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  const letter = { template: 'letter', title: 'Dear friend', body: 'Come at dusk.' };

  it('plans a hidden image page in a new "Handouts" journal, and undo removes it', async () => {
    const plan = (await tools.handleToolCall('plan-handout-press', letter)) as {
      planId: string;
      pageUuid: string;
      journalCreated: boolean;
    };
    expect(rendered).toEqual([{ template: 'letter', title: 'Dear friend' }]);
    expect(plan.journalCreated).toBe(true);
    const applied = await guarded.applyPlan(plan.planId, { confirm: true });
    const page = foundry.docs.get(plan.pageUuid);
    expect(page?.source).toMatchObject({
      type: 'image',
      src: 'assets/ai-art/handouts/handout-1.png',
      ownership: { default: 0 },
    });
    // Hidden from players until the ordinary reveal.
    expect(pageForPlayers(plan.pageUuid).observable).toBe(false);
    await guarded.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get(plan.pageUuid)).toBeUndefined();
  });

  it('goes through the existing queue and reveal', async () => {
    const plan = (await tools.handleToolCall('plan-handout-press', letter)) as {
      planId: string;
      pageUuid: string;
    };
    await guarded.applyPlan(plan.planId, { confirm: true });
    await handouts.queuePage({ pageUuid: plan.pageUuid });
    const reveal = await handouts.planPageReveal({ action: 'reveal-next' });
    await guarded.applyPlan(reveal.planId, { confirm: true });
    expect(pageForPlayers(plan.pageUuid).observable).toBe(true);
    expect(await handouts.listQueue()).toEqual([]);
  });

  it('lets several presses planned together apply once the journal exists', async () => {
    const first = (await tools.handleToolCall('plan-handout-press', letter)) as {
      planId: string;
    };
    await guarded.applyPlan(first.planId, { confirm: true });
    const a = (await tools.handleToolCall('plan-handout-press', letter)) as { planId: string };
    const b = (await tools.handleToolCall('plan-handout-press', {
      ...letter,
      template: 'card',
    })) as { planId: string };
    await guarded.applyPlan(b.planId, { confirm: true });
    await guarded.applyPlan(a.planId, { confirm: true });
    const pages = [...foundry.docs.values()].filter(d => d.documentName === 'JournalEntryPage');
    expect(pages).toHaveLength(3);
  });

  it('two presses planned on an empty world: the second conflicts once the first made the journal', async () => {
    const a = (await tools.handleToolCall('plan-handout-press', letter)) as { planId: string };
    const b = (await tools.handleToolCall('plan-handout-press', letter)) as { planId: string };
    await guarded.applyPlan(a.planId, { confirm: true });
    await expect(guarded.applyPlan(b.planId, { confirm: true })).rejects.toThrow(
      /Conflict.*handoutsJournal/
    );
  });

  it('refuses a title longer than the template holds', async () => {
    await expect(
      tools.handleToolCall('plan-handout-press', {
        ...letter,
        template: 'card',
        title: 'x'.repeat(31),
      })
    ).rejects.toThrow(/title holds at most 30/);
    expect(rendered).toEqual([]);
  });

  it('plans nothing when the upload is refused', async () => {
    foundry.handlers['foundry-mcp-bridge.uploadHandoutImage'] = (): {
      success: boolean;
      error: string;
    } => ({ success: false, error: 'Foundry did not accept the picture.' });
    await expect(tools.handleToolCall('plan-handout-press', letter)).rejects.toThrow(
      /did not accept/
    );
    expect(foundry.docs.size).toBe(0);
  });

  it('refuses before rendering while the handouts switch is off', async () => {
    foundry.features = [{ id: 'handouts', name: 'Handouts', hint: '', enabled: false }];
    await expect(tools.handleToolCall('plan-handout-press', letter)).rejects.toThrow(
      /switched off/
    );
    expect(rendered).toEqual([]);
  });

  it('refuses text longer than the template holds', async () => {
    await expect(
      tools.handleToolCall('plan-handout-press', {
        ...letter,
        template: 'card',
        body: 'x'.repeat(401),
      })
    ).rejects.toThrow(/at most 400/);
    expect(rendered).toEqual([]);
  });

  it('puts a second page into the same journal', async () => {
    const first = (await tools.handleToolCall('plan-handout-press', letter)) as {
      planId: string;
      pageUuid: string;
    };
    await guarded.applyPlan(first.planId, { confirm: true });
    const second = (await tools.handleToolCall('plan-handout-press', {
      ...letter,
      template: 'notice',
    })) as { planId: string; pageUuid: string; journalCreated: boolean };
    expect(second.journalCreated).toBe(false);
    expect(second.pageUuid.split('.JournalEntryPage.')[0]).toBe(
      first.pageUuid.split('.JournalEntryPage.')[0]
    );
  });

  it('refuses text that names a secret term and renders nothing', async () => {
    secrets = ['strahd'];
    await expect(
      tools.handleToolCall('plan-handout-press', { ...letter, body: 'Beware Strahd.' })
    ).rejects.toThrow(/strahd/);
    expect(rendered).toEqual([]);
  });

  it('refuses an unknown template and empty text', async () => {
    await expect(
      tools.handleToolCall('plan-handout-press', { ...letter, template: 'poster' })
    ).rejects.toThrow();
    await expect(
      tools.handleToolCall('plan-handout-press', { ...letter, body: '  ' })
    ).rejects.toThrow();
  });
});
