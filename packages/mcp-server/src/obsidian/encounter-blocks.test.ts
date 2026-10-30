/**
 * Encounter blocks in Prep notes (I-052): the parser, and what the digest's prep part shows from a
 * temp vault. Read-only: the vault is the same after the read.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PREP_ENCOUNTER_MAX_CREATURES, PREP_ENCOUNTERS_MAX } from '@gnuminator/shared';

import { parseCreatureEntry, parseEncounterBlocks } from './encounter-blocks.js';
import { readPrepNotes } from './prep-notes.js';
import { rmTmp } from '../test-support/rm-tmp.js';

const BLOCK = [
  '```encounter',
  'name: Goblin Ambush',
  'creatures:',
  '  - 2: Goblin',
  '  - Bugbear',
  '```',
];

describe('parseCreatureEntry', () => {
  it.each([
    ['Goblin', 'Goblin', 1],
    ['2: Goblin', 'Goblin', 2],
    ['3: [Wolf, 11, 13]', 'Wolf', 3],
    ['[2, Wolf]', 'Wolf', 2],
    ['Goblin, 7, 15', 'Goblin', 1],
    ['"Dire Wolf"', 'Dire Wolf', 1],
    ['2: [[Monsters/Ghoul|Ghoul]]', 'Ghoul', 2],
    ['999: Rat', 'Rat', 50],
  ])('%s', (entry, name, count) => {
    expect(parseCreatureEntry(entry)).toEqual({ name, count });
  });

  it('gives nothing for an entry without a name', () => {
    expect(parseCreatureEntry('2:')).toBeNull();
    expect(parseCreatureEntry('')).toBeNull();
  });
});

describe('parseEncounterBlocks', () => {
  it('reads name and creatures', () => {
    expect(parseEncounterBlocks(BLOCK.join('\n'), 'Note')).toEqual([
      {
        name: 'Goblin Ambush',
        creatures: [
          { name: 'Goblin', count: 2 },
          { name: 'Bugbear', count: 1 },
        ],
        total: 3,
        truncated: false,
      },
    ]);
  });

  it('uses the note name when the block has none, and handles CRLF and a BOM', () => {
    const text = `${String.fromCharCode(0xfeff)}# Plan\r\n\`\`\`encounter\r\ncreatures:\r\n  - Wolf\r\n\`\`\`\r\n`;
    expect(parseEncounterBlocks(text, 'Wolves')[0]?.name).toBe('Wolves');
  });

  it('skips other fences, empty blocks and commented-out blocks', () => {
    const text = [
      '```js',
      'creatures:',
      '  - Dragon',
      '```',
      '```encounter',
      'name: Empty',
      '```',
      '%%',
      ...BLOCK,
      '%%',
    ].join('\n');
    expect(parseEncounterBlocks(text, 'N')).toEqual([]);
  });

  it('caps the creatures per block', () => {
    const creatures = Array.from({ length: 20 }, (_, i) => `  - Orc ${i}`);
    const [block] = parseEncounterBlocks(
      ['```encounter', 'creatures:', ...creatures, '```'].join('\n'),
      'N'
    );
    expect(block?.creatures).toHaveLength(PREP_ENCOUNTER_MAX_CREATURES);
    expect(block?.truncated).toBe(true);
    expect(block?.total).toBe(20);
  });
});

describe('readPrepNotes encounters', () => {
  let vaultDir: string;
  const WORLD = 'w1';
  const CANARY = 'CANARY-ENCOUNTER-SECRET-91bd';

  async function note(rel: string, text: string): Promise<void> {
    const full = path.join(vaultDir, 'Campaigns', WORLD, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, text, 'utf8');
  }
  const doc = (props: string[], body: string[] = BLOCK): string =>
    ['---', ...props, '---', ...body].join('\n');
  const read = (): ReturnType<typeof readPrepNotes> =>
    readPrepNotes({ vaultDir, worldId: WORLD, wanted: null, matchedAgainst: null });

  beforeEach(async () => {
    vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prep-encounters-'));
  });
  afterEach(async () => {
    await rmTmp(vaultDir);
  });

  it('suggests an encounter from an encounter-prep note and writes nothing', async () => {
    await note('Prep/Encounters/Ambush.md', doc(['type: encounter-prep', `secret: ${CANARY}`]));
    const before = await fsp.readFile(
      path.join(vaultDir, 'Campaigns', WORLD, 'Prep/Encounters/Ambush.md'),
      'utf8'
    );
    const { part } = await read();
    expect(part.encounters).toEqual([
      {
        path: 'Prep/Encounters/Ambush.md',
        encounters: [expect.objectContaining({ name: 'Goblin Ambush', total: 3 })],
      },
    ]);
    expect(JSON.stringify(part)).not.toContain(CANARY);
    const after = await fsp.readFile(
      path.join(vaultDir, 'Campaigns', WORLD, 'Prep/Encounters/Ambush.md'),
      'utf8'
    );
    expect(after).toBe(before);
    expect(await fsp.readdir(path.join(vaultDir, 'Campaigns', WORLD))).toEqual(['Prep']);
  });

  it('keeps out ai_context: false, templates, the tool folder and conflict copies', async () => {
    const canary = [`Orc${CANARY}`];
    const block = ['```encounter', 'creatures:', `  - ${canary[0]}`, '```'];
    await note(
      'Prep/Encounters/Hidden.md',
      doc(['type: encounter-prep', 'ai_context: false'], block)
    );
    await note('Prep/Templates/Encounter.md', doc(['type: encounter-prep'], block));
    await note('AI Tool/Foundry/Encounters/M.md', doc(['type: encounter-prep'], block));
    await note(
      'Prep/Encounters/A.sync-conflict-20261028-120000-ABC.md',
      doc(['type: encounter-prep'], block)
    );
    await note('Prep/NPCs/N.md', doc(['type: npc-prep'], block));
    const { part } = await read();
    expect(part.encounters).toBeUndefined();
    expect(part.keptOut).toBe(1);
    expect(JSON.stringify(part)).not.toContain(CANARY);
  });

  it('caps the notes', async () => {
    for (let i = 0; i < PREP_ENCOUNTERS_MAX + 2; i++) {
      await note(`Prep/Encounters/E${i}.md`, doc(['type: encounter-prep']));
    }
    const { part } = await read();
    expect(part.encounters).toHaveLength(PREP_ENCOUNTERS_MAX);
  });
});
