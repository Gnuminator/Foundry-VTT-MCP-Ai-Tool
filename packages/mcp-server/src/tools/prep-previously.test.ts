/**
 * "Previously on": a temporary sessions folder laid out like the voice pipeline's
 * (`<session>-discord/notes/`). The text is made up for the test; no session text is in the repo.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PREP_PREVIOUSLY_MAX_CHARS } from '@gnuminator/shared';

import { readPreviously } from './prep-previously.js';

const EM_DASH = String.fromCharCode(0x2014);
const BOM = String.fromCharCode(0xfeff);

let dir: string;

async function put(session: string, file: string, text: string): Promise<void> {
  const notes = path.join(dir, session, 'notes');
  await fsp.mkdir(notes, { recursive: true });
  await fsp.writeFile(path.join(notes, file), text, 'utf8');
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prep-previously-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('readPreviously', () => {
  it('counts a restarted recording (-discord-2) in the same minute as the newest session', async () => {
    await put('2026-10-08_2000-discord', 'summary.en.md', '# Summary: Older\n\nOlder text.\n');
    await put('2026-10-15_2000-discord', 'summary.en.md', '# Summary: First try\n\nAborted.\n');
    await put(
      '2026-10-15_2000-discord-2',
      'summary.en.md',
      '# Summary: Restarted\n\nThe real session text.\n'
    );
    const r = await readPreviously(dir);
    expect(r).toMatchObject({
      status: 'found',
      session: '2026-10-15_2000-discord-2',
      title: 'Restarted',
    });
  });

  it('sorts the restart number as a number (-discord-10 is newer than -discord-9)', async () => {
    await put('2026-10-15_2000-discord-9', 'summary.en.md', '# Summary: Nine\n\nNine.\n');
    await put('2026-10-15_2000-discord-10', 'summary.en.md', '# Summary: Ten\n\nTen.\n');
    const r = await readPreviously(dir);
    expect(r).toMatchObject({ status: 'found', session: '2026-10-15_2000-discord-10' });
  });

  it('skips a summary file over 64 KB without reading it', async () => {
    await put('2026-10-08_2000-discord', 'summary.en.md', '# Summary: Small\n\nSmall.\n');
    await put(
      '2026-10-15_2000-discord',
      'summary.en.md',
      `# Summary: Huge\n\n${'x'.repeat(70 * 1024)}\n`
    );
    const r = await readPreviously(dir);
    expect(r).toMatchObject({ status: 'found', session: '2026-10-08_2000-discord' });
  });

  it('reads the English GM summary of the newest session', async () => {
    await put('2026-10-01_2000-discord', 'summary.en.md', '# Summary: Older\n\nOlder text.\n');
    await put(
      '2026-10-08_2000-discord',
      'summary.en.md',
      '# Summary: Newer\n\nThe party found a test key.\n\n## What changed\n\n- A door opened.\n'
    );
    const result = await readPreviously(dir);
    expect(result).toEqual({
      status: 'found',
      sessionsDir: dir,
      session: '2026-10-08_2000-discord',
      lang: 'en',
      title: 'Newer',
      text: 'The party found a test key.\n\n## What changed\n\n- A door opened.',
      truncated: false,
      note: 'Previously on: the English GM summary of 2026-10-08_2000-discord.',
    });
  });

  it('skips a newer session whose summary is not written yet, or that has none', async () => {
    await put('2026-10-01_2000-discord', 'summary.en.md', '# Summary: Written\n\nWritten text.\n');
    await put(
      '2026-10-08_2000-discord',
      'summary.en.md',
      '# Summary\n\nNot written yet (run session-notes again).\n'
    );
    await fsp.mkdir(path.join(dir, '2026-10-15_2000-discord', 'notes'), { recursive: true });
    const result = await readPreviously(dir);
    expect(result.status).toBe('found');
    expect(result.status === 'found' && result.session).toBe('2026-10-01_2000-discord');
  });

  it('falls back to the Danish summary when only that one was written', async () => {
    await put('2026-10-08_2000-discord', 'summary.da.md', '# Resumé: Prøve\n\nEn prøvetekst.\n');
    const result = await readPreviously(dir);
    expect(result).toMatchObject({ status: 'found', lang: 'da', title: 'Prøve' });
    expect(result.note).toContain('Danish');
  });

  it('never reads the player recap draft or a transcript', async () => {
    await put(
      '2026-10-08_2000-discord',
      'recap.player.en.md',
      '# Recap for the players\n\nDraft.\n'
    );
    await put('2026-10-08_2000-discord', 'transcript.en.md', '# Transcript\n\nWords.\n');
    await put('2026-10-08_2000-discord', 'scenes.en.md', '# Scenes\n\nScene text.\n');
    const result = await readPreviously(dir);
    expect(result.status).toBe('none');
    expect(JSON.stringify(result)).not.toMatch(/Draft|Words|Scene text/);
  });

  it('only looks at folders ending in -discord', async () => {
    await put('2026-10-08_2000-other', 'summary.en.md', '# Summary: Not a recording\n\nText.\n');
    const result = await readPreviously(dir);
    expect(result.status).toBe('none');
    expect(result.note).toBe(`No "Previously on": there is no recorded session in ${dir} yet.`);
  });

  it('says when there are sessions but none has a summary', async () => {
    await fsp.mkdir(path.join(dir, '2026-10-08_2000-discord'), { recursive: true });
    const result = await readPreviously(dir);
    expect(result.status).toBe('none');
    expect(result.note).toMatch(/no recorded session in .* has a GM summary yet/);
  });

  it('says plainly when this process cannot see the folder', async () => {
    const missing = path.join(dir, 'elsewhere');
    const result = await readPreviously(missing);
    expect(result).toEqual({
      status: 'unreachable',
      sessionsDir: missing,
      note: expect.stringContaining(`cannot see the session notes folder ${missing}`),
    });
    expect(result.note).toContain('does not exist here');
  });

  it('shortens a long summary at a line end and says so', async () => {
    const line = 'A test line about nothing in particular.';
    const body = Array.from({ length: 100 }, () => line).join('\n');
    await put('2026-10-08_2000-discord', 'summary.en.md', `# Summary: Long\n\n${body}\n`);
    const result = await readPreviously(dir);
    if (result.status !== 'found') throw new Error('expected a summary');
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(PREP_PREVIOUSLY_MAX_CHARS);
    expect(result.text.endsWith(line)).toBe(true);
    expect(result.note).toContain('shortened');
  });

  it('handles Windows line ends and a byte order mark', async () => {
    await put(
      '2026-10-08_2000-discord',
      'summary.en.md',
      `${BOM}# Summary: Crlf\r\n\r\nOne.\r\nTwo.\r\n`
    );
    const result = await readPreviously(dir);
    expect(result).toMatchObject({ status: 'found', title: 'Crlf', text: 'One.\nTwo.' });
  });

  it('writes no em dashes in its notes', async () => {
    const notes = [
      (await readPreviously(path.join(dir, 'x'))).note,
      (await readPreviously(dir)).note,
    ];
    await put('2026-10-08_2000-discord', 'summary.en.md', '# Summary: T\n\nText.\n');
    notes.push((await readPreviously(dir)).note);
    expect(notes.join(' ')).not.toContain(EM_DASH);
  });
});
