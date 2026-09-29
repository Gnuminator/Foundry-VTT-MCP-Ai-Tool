/**
 * Canary suite for the Obsidian mirror (docs/design/OBSIDIAN-O4-DESIGN.md sections 7
 * and 8): the bridge vault is seeded with unique strings in every GM-only file
 * (the Tarokka reading and its card name overrides, which are also the secret
 * terms, the audit file and its history, a reveal's own fields) and the fake
 * Foundry world carries hostile names and an opted-in page with its own canary.
 * The pump runs with the real converter and renderer; then every file in the
 * Obsidian vault and every log line is searched.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretTermsService } from '../secret-terms.js';
import { TAROKKA_POSITIONS } from '../tarokka/deck.js';
import { REVEALS_FILE, TAROKKA_CONFIG_FILE, TAROKKA_FILE } from '../tarokka/service.js';
import {
  FakeExportIndex,
  fid,
  journalEntry,
  npcEntry,
  pageEntry,
  pcEntry,
  sceneEntry,
} from '../test-support/fake-export-index.js';
import { AUDIT_FILE, AUDIT_HISTORY_FILE } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';

import { ObsidianMirrorPump } from './mirror-pump.js';
import { MIRROR_SETTINGS_FILE } from './mirror-settings.js';

const WORLD = 'canary-world';

const CARD_CANARIES = TAROKKA_POSITIONS.map((_, i) => `canaryTarokkaCard${i}Qz`);
const VAULT_CANARIES = [
  ...CARD_CANARIES,
  'canaryCardOverrideQz',
  'canaryTarokkaGmNoteQz',
  'canaryTarokkaReadingQz',
  'canaryAuditSummaryQz',
  'canaryAuditDiffQz',
  'canaryAuditHistoryQz',
  'canaryRevealNoteQz',
];
const PAGE_CANARY = 'canaryOptedPageQz';
const PAGE_SECRET_CANARY = 'canaryPageSecretQz';
const NOT_OPTED_CANARY = 'canaryNotOptedPageQz';

const OPTED_HTML = [
  '<h2>The village</h2>',
  `<p>${PAGE_CANARY} meets @UUID[Actor.${fid('wolf')}]{the wolf} by the gate.</p>`,
  '<p><a href="javascript:alert(1)">click me</a> and <a href="obsidian://open?vault=x">open</a></p>',
  '<p><% tp.system.prompt("x") %> then <%* await app.vault.adapter.remove("a") %> and [[Evil Note]] and ![[embed]]</p>',
  `<section class="secret"><p>${PAGE_SECRET_CANARY}</p></section>`,
  '<p>@UUID[Compendium.dnd5e.monsters.Actor.abcdefghijklmnop]{Goblin} %%hidden%% #tag</p>',
  '<pre>```dataviewjs\napp.vault.delete()\n```</pre>',
].join('\n');

const HOSTILE = '<% tp.file.move("/pwned") %>';

let tmp: string;
let vault: string;
let store: VaultStore;
let fake: FakeExportIndex;
let clock: { t: number };
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

async function seedBridgeVault(): Promise<void> {
  const positions = Object.fromEntries(
    TAROKKA_POSITIONS.map((position, i) => [
      position,
      {
        cardName: CARD_CANARIES[i],
        cardId: `card-${i}`,
        gmNote: 'canaryTarokkaGmNoteQz',
        revealed: false,
      },
    ])
  );
  await store.write(WORLD, 'gm', TAROKKA_FILE, {
    current: {
      readingId: 'canaryTarokkaReadingQz',
      source: 'built-in',
      readAt: '2026-09-29T00:00:00.000Z',
      providerVersion: null,
      positions,
    },
  });
  await store.write(WORLD, 'gm', TAROKKA_CONFIG_FILE, {
    cardNames: { 'card-0': 'canaryCardOverrideQz' },
  });
  await store.write(WORLD, 'gm', AUDIT_FILE, {
    entries: [{ id: 'a1', summary: 'canaryAuditSummaryQz', diff: ['+ canaryAuditDiffQz'] }],
  });
  await store.appendLines(WORLD, 'gm', AUDIT_HISTORY_FILE, [{ summary: 'canaryAuditHistoryQz' }]);
  const village = `JournalEntry.${fid('handouts')}.JournalEntryPage.${fid('village')}`;
  await store.write(WORLD, 'gm', REVEALS_FILE, {
    pages: {
      [fid('village')]: {
        uuid: village,
        feature: 'handouts',
        at: '2026-09-29T00:00:00.000Z',
        note: 'canaryRevealNoteQz',
      },
    },
  });
  await store.write(WORLD, 'gm', MIRROR_SETTINGS_FILE, {
    settings: { enabled: true, text: { folderIds: [], journalIds: [fid('handouts')] } },
  });
}

function seedWorld(): void {
  fake.worldId = WORLD;
  fake.put(pcEntry('hero', 'Test Hero', { features: [{ name: HOSTILE, type: 'feat' }] }));
  fake.put(npcEntry('wolf', 'Wolf'));
  fake.put(npcEntry('imp', `Imp ${HOSTILE}`, { tokenName: HOSTILE, playerName: HOSTILE }));
  fake.put(sceneEntry('arena', 'Test Arena', { navigation: true, navName: HOSTILE }));
  fake.put(
    journalEntry('handouts', 'Handouts', [
      pageEntry('handouts', 'village', 'Village', OPTED_HTML, { sort: 1 }),
      pageEntry('handouts', 'hostile', `Page ${HOSTILE}`, `<p>${HOSTILE}</p>`, { sort: 2 }),
    ])
  );
  fake.put(
    journalEntry('secrets', 'GM Secrets', [
      pageEntry('secrets', 'plot', 'Plot', `<p>${NOT_OPTED_CANARY}</p>`),
    ])
  );
}

/** Every file under `dir` (dot folders included), relative with POSIX separators. */
async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    const childRel = rel ? `${rel}/${name}` : name;
    const stat = await fsp.lstat(path.join(dir, name));
    if (stat.isDirectory()) out.push(...(await listFiles(path.join(dir, name), childRel)));
    else out.push(childRel);
  }
  return out;
}

async function vaultFiles(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of await listFiles(vault)) {
    out.set(file, await fsp.readFile(path.join(vault, ...file.split('/')), 'utf8'));
  }
  return out;
}

function filesContaining(files: Map<string, string>, needle: string | RegExp): string[] {
  return [...files]
    .filter(([, text]) => (typeof needle === 'string' ? text.includes(needle) : needle.test(text)))
    .map(([file]) => file);
}

/** The text with fenced blocks and inline code spans removed (what Obsidian parses as Markdown). */
function withoutCode(text: string): string {
  return text
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/(`+)[^\n]*?\1/g, '');
}

const CAMPAIGN = `Campaigns/${WORLD}/AI Tool`;
const PAGE_NOTE = `${CAMPAIGN}/Foundry/Journals/Handouts/Village.md`;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-canary-'));
  vault = path.join(tmp, 'obsidian');
  await fsp.mkdir(vault, { recursive: true });
  store = new VaultStore({ dataDir: path.join(tmp, 'bridge') });
  fake = new FakeExportIndex();
  clock = { t: 1_000_000 };
  logger = { info: vi.fn(), warn: vi.fn() };
  await seedBridgeVault();
  seedWorld();
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

async function runPump(): Promise<ObsidianMirrorPump> {
  const pump = new ObsidianMirrorPump({
    foundryClient: fake,
    worldIds: { current: () => Promise.resolve(WORLD) },
    store,
    vaultDir: vault,
    logger,
    pollMs: 10_000,
    openBase: 'http://localhost:3000',
    now: () => clock.t,
  });
  await pump.tick(); // the start reconcile
  // An incremental cycle with a change, then a later reconcile.
  fake.edit(`Actor.${fid('wolf')}`, e => (e.name = 'Dire Wolf'), 60_000);
  clock.t += 10_000;
  await pump.tick();
  pump.requestReconcile();
  clock.t += 60_001;
  await pump.tick();
  return pump;
}

describe('Obsidian mirror canaries', () => {
  it('the seeded vault really holds the secret terms (the canaries are live)', async () => {
    const terms = new SecretTermsService({ store });
    for (const term of [CARD_CANARIES[0] ?? '', 'canaryCardOverrideQz']) {
      const { matches } = await terms.findSecretTerms(WORLD, `say ${term} now`);
      expect(matches).toEqual([{ category: 'tarokka-card', term }]);
    }
  });

  it('no bridge-vault secret reaches any file in the Obsidian vault or the logs', async () => {
    const pump = await runPump();
    expect(pump.status().lastError).toBeNull();
    const files = await vaultFiles();
    expect(files.has(PAGE_NOTE)).toBe(true);
    expect(files.get(`${CAMPAIGN}/Foundry/NPCs/Wolf.md`)).toContain('# Dire Wolf');
    for (const canary of VAULT_CANARIES) {
      expect(filesContaining(files, canary), canary).toEqual([]);
    }
    const logs = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    for (const canary of [...VAULT_CANARIES, PAGE_CANARY, PAGE_SECRET_CANARY]) {
      expect(logs.includes(canary), canary).toBe(false);
    }
  });

  it('the opted-in page text appears only in its own page note', async () => {
    await runPump();
    const files = await vaultFiles();
    expect(filesContaining(files, PAGE_CANARY)).toEqual([PAGE_NOTE]);
    expect(filesContaining(files, PAGE_SECRET_CANARY)).toEqual([PAGE_NOTE]);
    expect(files.get(PAGE_NOTE)).toMatch(/> \[!secret\]- GM secret/);
    // The reveal flag is the only bridge-vault input.
    expect(files.get(PAGE_NOTE)).toContain('revealed: true');
    // A journal without the opt-in never has text anywhere.
    expect(filesContaining(files, NOT_OPTED_CANARY)).toEqual([]);
  });

  it('nothing from Foundry can run as a Templater command, link, embed or script', async () => {
    await runPump();
    const files = await vaultFiles();
    expect(files.size).toBeGreaterThan(10);
    expect(filesContaining(files, '<%')).toEqual([]);
    expect(filesContaining(files, 'javascript:')).toEqual([]);
    expect(filesContaining(files, 'obsidian://')).toEqual([]);
    // `[[...]]` is Foundry's inline roll syntax: kept as inline code, which Obsidian never links.
    const outsideCode = new Map([...files].map(([file, text]) => [file, withoutCode(text)]));
    expect(filesContaining(outsideCode, /(?<!\\)\[\[Evil/)).toEqual([]);
    expect(filesContaining(outsideCode, /(?<!\\)!\[\[embed/)).toEqual([]);
    expect(files.get(PAGE_NOTE)).toContain('`[[Evil Note]]`');
    // A `pre` becomes a `text` fence one backtick longer than any run inside it.
    expect(filesContaining(outsideCode, /^```dataviewjs/m)).toEqual([]);
    expect(files.get(PAGE_NOTE)).toMatch(/^````text\n```dataviewjs\n/m);
    expect(filesContaining(files, /(?<!%\\)%%hidden/)).toEqual([]);
    // The hostile names are there, neutralized.
    expect(filesContaining(files, '&lt;% tp.file.move').length).toBeGreaterThan(0);
  });
});
