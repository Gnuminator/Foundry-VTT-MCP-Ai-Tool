/** The table agenda part of the digest: a temporary sessions folder with a made-up table-agenda.json. */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PREP_AGENDA_MAX_ITEMS } from '@gnuminator/shared';

import { readAgenda } from './prep-agenda.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prep-agenda-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const write = (items: unknown[]): Promise<void> =>
  fsp.writeFile(path.join(dir, 'table-agenda.json'), JSON.stringify({ schema: 1, items }), 'utf8');

describe('readAgenda', () => {
  it('lists open items and only counts settled and dropped ones', async () => {
    await write([
      {
        id: 'a',
        session: 's0',
        topic: 'proposed',
        en: 'Fumble rule',
        da: 'x',
        status: 'open',
        source: { time: '00:39:12' },
      },
      { id: 'b', session: 's0', topic: 'open', en: '', da: 'Snacks', status: 'open' },
      { id: 'c', session: 's0', topic: 'proposed', en: 'Potion cost', status: 'settled' },
      { id: 'd', session: 's0', topic: 'proposed', en: 'Help rule', status: 'dropped' },
    ]);
    const agenda = await readAgenda(dir);
    expect(agenda).toMatchObject({ status: 'found', omitted: 0, settled: 1, dropped: 1 });
    if (agenda.status !== 'found') throw new Error('expected found');
    expect(agenda.items).toEqual([
      { id: 'a', session: 's0', topic: 'proposed', text: 'Fumble rule', time: '00:39:12' },
      { id: 'b', session: 's0', topic: 'open', text: 'Snacks' },
    ]);
  });

  it('caps the list and counts the rest', async () => {
    await write(
      Array.from({ length: PREP_AGENDA_MAX_ITEMS + 3 }, (_, i) => ({
        id: String(i),
        session: 's0',
        topic: 'open',
        en: `Q${i}`,
        status: 'open',
      }))
    );
    const agenda = await readAgenda(dir);
    expect(agenda).toMatchObject({ status: 'found', omitted: 3 });
  });

  it('says none when no agenda is written and unreachable when it is broken', async () => {
    expect((await readAgenda(dir)).status).toBe('none');
    await fsp.writeFile(path.join(dir, 'table-agenda.json'), '{nope', 'utf8');
    expect((await readAgenda(dir)).status).toBe('unreachable');
  });
});
