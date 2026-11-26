import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OmensStore } from '../omens/store.js';
import { VaultStore } from '../vault/store.js';

import { LedgerStore, handleLedgerControl, knownByLine } from './store.js';
import { WhisperDesk } from './whisper-desk.js';

const JORR = 'jjjjjjjjjjjjjjjj';
const MIA = 'mmmmmmmmmmmmmmmm';
const PAGE = 'pppppppppppppppp';
const DISCORD_JORR = '123456789012345678';

let dataDir: string;
let store: VaultStore;
let ledger: LedgerStore;
let counter: number;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ledger-'));
  counter = 0;
  store = new VaultStore({ dataDir });
  const ids = (): string => `id${String(++counter).padStart(14, '0')}`;
  ledger = new LedgerStore({
    store,
    worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
    newId: ids,
    now: (): number => Date.UTC(2026, 10, 26, 12, 0, counter),
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('who knows what ledger', () => {
  it('words who knows a secret', () => {
    expect(knownByLine([])).toBe('Nobody knows this yet');
    expect(knownByLine([{ userId: JORR, name: 'Jorr' }])).toBe('Only Jorr knows this');
    expect(
      knownByLine([
        { userId: JORR, name: 'Jorr' },
        { userId: MIA, name: 'Mia' },
      ])
    ).toBe('Jorr and Mia know this');
  });

  it('stores an entry in the GM folder and answers who-knows queries', async () => {
    await ledger.add({
      kind: 'backstory',
      text: '  Jorr owes the baron a life.  ',
      knownBy: [{ userId: JORR, name: 'Jorr' }],
      pageId: PAGE,
      pageName: 'Jorr backstory',
    });
    await ledger.add({ text: 'The well is cursed.', knownBy: [] });
    const all = await ledger.list();
    expect(all).toHaveLength(2);
    expect(all.find(e => e.kind === 'backstory')?.text).toBe('Jorr owes the baron a life.');
    expect((await ledger.query({ who: 'jorr' })).map(e => e.kind)).toEqual(['backstory']);
    expect(await ledger.query({ who: 'mia' })).toEqual([]);
    expect((await ledger.query({ text: 'well' })).map(e => e.text)).toEqual([
      'The well is cursed.',
    ]);
    // The GM-only vault folder holds it, never a player-readable one.
    const stored = await fsp.readdir(path.join(dataDir), { recursive: true });
    expect(stored.some(p => p.includes('ledger.json') && p.includes('gm'))).toBe(true);
  });

  it('makes a chip per page: the knowers of every entry, or nobody', async () => {
    await ledger.add({
      text: 'a',
      knownBy: [
        { userId: JORR, name: 'Jorr' },
        { userId: MIA, name: 'Mia' },
      ],
      pageId: PAGE,
    });
    expect((await ledger.pageChips())[PAGE]?.line).toBe('Jorr and Mia know this');
    await ledger.add({ text: 'b', knownBy: [{ userId: JORR, name: 'Jorr' }], pageId: PAGE });
    expect((await ledger.pageChips())[PAGE]?.line).toBe('Only Jorr knows this');
    await ledger.add({ text: 'c', knownBy: [], pageId: PAGE });
    expect((await ledger.pageChips())[PAGE]?.line).toBe('Nobody knows this yet');
  });

  it('changes who knows, removes, and refuses bad input', async () => {
    const entry = await ledger.add({ text: 'x', knownBy: [] });
    const changed = await ledger.setKnownBy(entry.id, [{ userId: MIA, name: 'Mia' }]);
    expect(changed.knownBy.map(k => k.name)).toEqual(['Mia']);
    await ledger.remove(entry.id);
    expect(await ledger.list()).toEqual([]);
    await expect(ledger.remove('nope')).rejects.toThrow(/No ledger entry/);
    await expect(ledger.add({ text: '   ' })).rejects.toThrow(/empty/);
    await expect(ledger.add({ text: 'x'.repeat(601) })).rejects.toThrow(/too long/);
    await expect(ledger.add({ text: 'x', kind: 'rumor' })).rejects.toThrow(/kind/);
    await expect(ledger.add({ text: 'x', pageId: '../x' })).rejects.toThrow(/page id/);
    await expect(
      ledger.add({ text: 'x', knownBy: [{ userId: 'bad', name: 'A' }] })
    ).rejects.toThrow(/user id/);
  });

  it('answers the control method', async () => {
    const added = (await handleLedgerControl(ledger, {
      action: 'add',
      text: 'A secret',
      knownBy: [{ userId: JORR, name: 'Jorr' }],
      pageId: PAGE,
    })) as { entry: { id: string } };
    const list = (await handleLedgerControl(ledger, { action: 'list' })) as {
      entries: unknown[];
      chips: Record<string, { line: string }>;
    };
    expect(list.entries).toHaveLength(1);
    expect(list.chips[PAGE]?.line).toBe('Only Jorr knows this');
    await handleLedgerControl(ledger, { action: 'remove', id: added.entry.id });
    await expect(handleLedgerControl(ledger, { action: 'nope' })).rejects.toThrow(/Unknown/);
  });
});

describe('whisper desk', () => {
  function desk(sent: string[], fail = false): { desk: WhisperDesk; omens: OmensStore } {
    const omens = new OmensStore({
      store,
      worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
      newId: (): string => `om${String(++counter).padStart(14, '0')}`,
    });
    return {
      omens,
      desk: new WhisperDesk({
        omens,
        ledger,
        sendFoundryWhisper: async (name, text): Promise<void> => {
          if (fail) throw new Error('Not delivered: no such user');
          sent.push(`${name}: ${text}`);
        },
      }),
    };
  }

  it('whispers in Foundry, queues Discord for a linked player and writes the ledger', async () => {
    const sent: string[] = [];
    const { desk: d, omens } = desk(sent);
    await omens.setPlayer(JORR, DISCORD_JORR);
    const result = await d.send(JORR, 'Jorr', '  You smell smoke.  ');
    expect(sent).toEqual(['Jorr: You smell smoke.']);
    expect(result.discord).toBe('queued');
    expect(result.entry?.kind).toBe('whisper');
    expect(result.entry?.knownBy.map(k => k.name)).toEqual(['Jorr']);
    // The bot's outbox carries it for that player only, marked as a whisper.
    const outbox = await omens.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ userId: JORR, text: 'You smell smoke.', kind: 'whisper' });
    expect((await ledger.query({ who: 'mia' })).length).toBe(0);
    expect((await ledger.query({ who: 'jorr' })).length).toBe(1);
  });

  it('says so when the player has no Discord link, and still records it', async () => {
    const sent: string[] = [];
    const { desk: d, omens } = desk(sent);
    const result = await d.send(JORR, 'Jorr', 'Psst.');
    expect(result.discord).toBe('no-link');
    expect(await omens.outbox()).toEqual([]);
    expect(await ledger.list()).toHaveLength(1);
  });

  it('records nothing when Foundry did not take the whisper', async () => {
    const { desk: d, omens } = desk([], true);
    await omens.setPlayer(JORR, DISCORD_JORR);
    await expect(d.send(JORR, 'Jorr', 'Psst.')).rejects.toThrow(/Not delivered/);
    expect(await ledger.list()).toEqual([]);
    expect(await omens.outbox()).toEqual([]);
  });

  it('refuses a missing player or an empty line', async () => {
    const { desk: d } = desk([]);
    await expect(d.send('', 'Jorr', 'x')).rejects.toThrow(/player/);
    await expect(d.send(JORR, 'Jorr', '  ')).rejects.toThrow(/Write/);
  });

  it('keeps a whisper from being edited into an omen', async () => {
    const { desk: d, omens } = desk([]);
    await omens.setPlayer(JORR, DISCORD_JORR);
    await d.send(JORR, 'Jorr', 'Psst.');
    const [item] = await omens.outbox();
    await expect(omens.edit(item.id, 'Changed')).rejects.toThrow(/whisper/);
  });
});
