/**
 * The Campaign Atlas (I-185): the quest and place canvases built from mirror notes, hand-moved
 * cards kept by id across exports, and ownership by the marker card.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rmTmp } from '../test-support/rm-tmp.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';

import {
  checkAtlasOwnership,
  isAtlasGeneratedId,
  mergeCanvas,
  PLACES_CANVAS_PATH,
  QUESTS_CANVAS_PATH,
  SPREAD_CARD_IDS,
} from './atlas.js';
import { renderSpreadCanvas } from './render.js';
import { exportWorldToObsidian, newExportCache } from './export.js';
import { bumpMirrorGeneration } from './mirror-generation.js';
import { campaignDir } from './note-writer.js';
import { withGeneratedHash } from './ownership.js';

const WORLD = 'sorvan-test';
let dataDir: string;
let vaultDir: string;
let root: string;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-data-'));
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-vault-'));
  root = campaignDir(vaultDir, WORLD);
});

afterEach(async () => {
  await rmTmp(dataDir);
  await rmTmp(vaultDir);
});

async function mirrorNote(
  rel: string,
  spec: { type: string; uuid: string; name: string; folder?: string; journal?: string },
  body = ''
): Promise<void> {
  const lines = [
    '---',
    `type: ${JSON.stringify(spec.type)}`,
    `name: ${JSON.stringify(spec.name)}`,
    `fvtt_uuid: ${JSON.stringify(spec.uuid)}`,
  ];
  if (spec.journal) lines.push(`fvtt_journal: ${JSON.stringify(spec.journal)}`);
  if (spec.folder) lines.push(`folder: ${JSON.stringify(spec.folder)}`);
  lines.push('generated_by: "foundry-ai-tool"', 'generated_hash: ""', '---', body, '');
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, withGeneratedHash(lines.join('\n')), 'utf8');
}

async function seedMirror(): Promise<void> {
  const base = 'AI Tool/Foundry';
  await mirrorNote(`${base}/NPCs/Ireena.md`, { type: 'npc', uuid: 'Actor.ireena', name: 'Ireena' });
  await mirrorNote(
    `${base}/Scenes/Village/Barovia.md`,
    { type: 'scene', uuid: 'Scene.barovia', name: 'Barovia', folder: 'Village' },
    '[Vallaki](Vallaki.md)'
  );
  await mirrorNote(`${base}/Scenes/Village/Vallaki.md`, {
    type: 'scene',
    uuid: 'Scene.vallaki',
    name: 'Vallaki',
    folder: 'Village',
  });
  await mirrorNote(`${base}/Scenes/Castle/Ravenloft.md`, {
    type: 'scene',
    uuid: 'Scene.ravenloft',
    name: 'Ravenloft',
    folder: 'Castle',
  });
  await mirrorNote(
    `${base}/Journals/Quests/Save Ireena.md`,
    { type: 'journal', uuid: 'JournalEntry.q1', name: 'Save Ireena', folder: 'Quests' },
    '[Ireena](../../NPCs/Ireena.md) and [Barovia](../../Scenes/Village/Barovia.md)'
  );
  await mirrorNote(
    `${base}/Journals/Quests/Save Ireena/Page.md`,
    {
      type: 'journal-page',
      uuid: 'JournalEntry.q1.JournalEntryPage.p',
      name: 'Page',
      journal: 'JournalEntry.q1',
    },
    '[Ravenloft](../../../Scenes/Castle/Ravenloft.md)'
  );
  await mirrorNote(`${base}/Journals/Lore.md`, {
    type: 'journal',
    uuid: 'JournalEntry.lore',
    name: 'Lore',
    folder: 'Handouts',
  });
}

async function run(): Promise<void> {
  const store = new VaultStore({ dataDir });
  await exportWorldToObsidian({ store, audit: new AuditLog(store), worldId: WORLD, vaultDir });
}

async function readCanvas(rel: string): Promise<{
  nodes: Array<{
    id: string;
    type?: string;
    file?: string;
    label?: string;
    text?: string;
    x: number;
    y: number;
  }>;
  edges: Array<{ id: string; fromNode: string; toNode: string }>;
}> {
  return JSON.parse(await fsp.readFile(path.join(root, rel), 'utf8')) as never;
}

describe('Campaign Atlas canvases', () => {
  it('writes no atlas canvases before the mirror has notes', async () => {
    await run();
    await expect(fsp.stat(path.join(root, QUESTS_CANVAS_PATH))).rejects.toThrow();
    await expect(fsp.stat(path.join(root, PLACES_CANVAS_PATH))).rejects.toThrow();
  });

  it('builds the quest web from quest journals, their pages and the notes they link to', async () => {
    await seedMirror();
    await run();
    const quests = await readCanvas(QUESTS_CANVAS_PATH);
    const files = quests.nodes.filter(n => n.type === 'file').map(n => n.file);
    expect(files.sort()).toEqual(
      [
        `Campaigns/${WORLD}/AI Tool/Foundry/Journals/Quests/Save Ireena.md`,
        `Campaigns/${WORLD}/AI Tool/Foundry/NPCs/Ireena.md`,
        `Campaigns/${WORLD}/AI Tool/Foundry/Scenes/Castle/Ravenloft.md`,
        `Campaigns/${WORLD}/AI Tool/Foundry/Scenes/Village/Barovia.md`,
      ].sort()
    );
    expect(quests.edges).toHaveLength(3);
    expect(quests.nodes.some(n => n.id === 'generated')).toBe(true);
  });

  it('builds the place map as one group per Foundry folder with arrows between linked scenes', async () => {
    await seedMirror();
    await run();
    const places = await readCanvas(PLACES_CANVAS_PATH);
    expect(
      places.nodes
        .filter(n => n.type === 'group')
        .map(n => n.label)
        .sort()
    ).toEqual(['Castle', 'Village']);
    expect(places.nodes.filter(n => n.type === 'file')).toHaveLength(3);
    expect(places.edges).toHaveLength(1);
  });

  it('keeps hand-moved cards and the GM cards across a second run', async () => {
    await seedMirror();
    await run();
    const file = path.join(root, PLACES_CANVAS_PATH);
    const doc = await readCanvas(PLACES_CANVAS_PATH);
    const card = doc.nodes.find(n => n.type === 'file');
    if (!card) throw new Error('no card');
    card.x = 4242;
    card.y = -77;
    doc.nodes.push({ id: 'mine', type: 'text', text: 'my note', x: 1, y: 2 });
    await fsp.writeFile(file, JSON.stringify(doc), 'utf8');
    // A new scene arrives; the next run adds its card and keeps the rest.
    await mirrorNote('AI Tool/Foundry/Scenes/Castle/Crypt.md', {
      type: 'scene',
      uuid: 'Scene.crypt',
      name: 'Crypt',
      folder: 'Castle',
    });
    await run();
    const after = await readCanvas(PLACES_CANVAS_PATH);
    const moved = after.nodes.find(n => n.id === card.id);
    expect([moved?.x, moved?.y]).toEqual([4242, -77]);
    expect(after.nodes.some(n => n.id === 'mine')).toBe(true);
    expect(after.nodes.filter(n => n.type === 'file')).toHaveLength(4);
    expect(checkAtlasOwnership(JSON.stringify(after)).owned).toBe(true);
  });

  it('skips the Atlas scan on an event-only render and rebuilds after a mirror change', async () => {
    const store = new VaultStore({ dataDir });
    const cache = newExportCache();
    const render = (): Promise<unknown> =>
      exportWorldToObsidian({
        store,
        audit: new AuditLog(store),
        worldId: WORLD,
        vaultDir,
        cache,
      });
    const fileCards = async (): Promise<number> =>
      (await readCanvas(PLACES_CANVAS_PATH)).nodes.filter(n => n.type === 'file').length;

    await seedMirror();
    await render();
    expect(await fileCards()).toBe(3);

    // A note lands in the vault without the pump reporting a write: an event-only render does
    // no scan, so the canvas does not change.
    await mirrorNote('AI Tool/Foundry/Scenes/Castle/Crypt.md', {
      type: 'scene',
      uuid: 'Scene.crypt',
      name: 'Crypt',
      folder: 'Castle',
    });
    await render();
    expect(await fileCards()).toBe(3);

    // The pump wrote, moved or trashed a note: the next render scans and rebuilds.
    bumpMirrorGeneration(WORLD);
    await render();
    expect(await fileCards()).toBe(4);
  });

  it('leaves a canvas alone once the GM deleted its marker card', async () => {
    await seedMirror();
    await run();
    const file = path.join(root, QUESTS_CANVAS_PATH);
    const doc = await readCanvas(QUESTS_CANVAS_PATH);
    doc.nodes = doc.nodes.filter(n => n.id !== 'generated');
    const text = JSON.stringify(doc);
    await fsp.writeFile(file, text, 'utf8');
    await mirrorNote('AI Tool/Foundry/NPCs/Ismark.md', {
      type: 'npc',
      uuid: 'Actor.ismark',
      name: 'Ismark',
    });
    await run();
    expect(await fsp.readFile(file, 'utf8')).toBe(text);
  });

  it('keeps card colours and arrow labels on the Atlas, drops arrows to cards that are gone', () => {
    const next = JSON.stringify({
      nodes: [
        {
          id: 'atlas-n-a',
          type: 'file',
          file: 'a.md',
          color: '1',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        { id: 'atlas-n-b', type: 'file', file: 'b.md', x: 0, y: 0, width: 1, height: 1 },
        { id: 'generated', type: 'text', text: '', x: 0, y: 0, width: 1, height: 1 },
      ],
      edges: [{ id: 'atlas-e-a-b', fromNode: 'atlas-n-a', toNode: 'atlas-n-b' }],
    });
    const existing = JSON.stringify({
      nodes: [{ id: 'atlas-n-a', color: '5', x: 9, y: 9, width: 1, height: 1 }],
      edges: [
        { id: 'atlas-e-a-b', label: 'owes', color: '3' },
        { id: 'mine', fromNode: 'atlas-n-a', toNode: 'gone' },
        { id: 'mine2', fromNode: 'atlas-n-a', toNode: 'atlas-n-b' },
      ],
    });
    const merged = JSON.parse(mergeCanvas(next, existing, isAtlasGeneratedId, true)) as {
      nodes: Array<{ id: string; color?: string }>;
      edges: Array<{ id: string; label?: string }>;
    };
    expect(merged.nodes.find(n => n.id === 'atlas-n-a')?.color).toBe('5');
    expect(merged.edges.map(e => e.id).sort()).toEqual(['atlas-e-a-b', 'mine2']);
    expect(merged.edges.find(e => e.id === 'atlas-e-a-b')?.label).toBe('owes');
  });

  it('keeps hand-moved cards on the Tarokka spread too', () => {
    const next = JSON.stringify({
      nodes: [
        { id: 'tome', type: 'text', text: 'new', x: 0, y: 0, width: 320, height: 220 },
        { id: 'generated', type: 'text', text: '', x: 1, y: 1, width: 9, height: 9 },
      ],
      edges: [],
    });
    const existing = JSON.stringify({
      nodes: [{ id: 'tome', type: 'text', text: 'old', x: 50, y: 60, width: 400, height: 300 }],
    });
    const merged = JSON.parse(mergeCanvas(next, existing, id => id === 'tome')) as {
      nodes: Array<{ id: string; text: string; x: number; width: number }>;
    };
    const tome = merged.nodes.find(n => n.id === 'tome');
    expect([tome?.text, tome?.x, tome?.width]).toEqual(['new', 50, 400]);
    expect(isAtlasGeneratedId('atlas-n-1')).toBe(true);
  });

  it('knows every card id the spread renderer makes', () => {
    const positions = Object.fromEntries(
      ['tome', 'holySymbol', 'sunsword', 'ally', 'strahdLocation'].map(key => [
        key,
        { cardId: `${key}-1`, cardName: key, revealed: false },
      ])
    );
    const ids = (text: string): string[] =>
      (JSON.parse(text) as { nodes: Array<{ id: string }> }).nodes
        .map(node => node.id)
        .filter(id => id !== 'generated');
    const rendered = [
      ...ids(renderSpreadCanvas({ readingId: 'r', positions } as never)),
      ...ids(renderSpreadCanvas(null)),
    ];
    expect(rendered.length).toBeGreaterThan(5);
    for (const id of rendered) expect(SPREAD_CARD_IDS.has(id)).toBe(true);
    expect(SPREAD_CARD_IDS.size).toBe(rendered.length);
  });
});
