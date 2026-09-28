/**
 * NoteWriter (moved out of export.ts, docs/OBSIDIAN-O4-DESIGN.md 3.5): the
 * O2 behaviors it kept (ownership, fence, prune; the O2 export tests cover the
 * rest), plus the O4 additions: the `same` comparator, the real-path fence
 * against links and junctions, and `trash`. Everything runs in temp folders.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { campaignDir, NoteWriter } from './note-writer.js';
import { checkMarkdownOwnership, withGeneratedHash } from './ownership.js';

const WORLD = 'strahd-test';
let tmp: string;
let vault: string;
let outside: string;
let root: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'note-writer-'));
  vault = path.join(tmp, 'vault');
  outside = path.join(tmp, 'outside');
  await fsp.mkdir(vault, { recursive: true });
  await fsp.mkdir(outside, { recursive: true });
  root = campaignDir(vault, WORLD);
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function newWriter(): NoteWriter {
  return new NoteWriter(root, vault, WORLD, { written: new Map() });
}

/** A note that passes `checkMarkdownOwnership` (hash filled in). */
function ownedNote(modified: string, body = 'Body'): string {
  return withGeneratedHash(
    [
      '---',
      'type: "npc"',
      `fvtt_modified: "${modified}"`,
      'generated_by: "foundry-ai-tool"',
      'generated_hash: ""',
      '---',
      body,
      '',
    ].join('\n')
  );
}

const ignoreModified = (existing: string, next: string): boolean => {
  const blank = (text: string): string =>
    text.replace(/^fvtt_modified: .*$/m, '').replace(/^generated_hash: .*$/m, '');
  return blank(existing) === blank(next);
};

async function readIfThere(full: string): Promise<string | null> {
  return fsp.readFile(full, 'utf8').catch(() => null);
}

/** A directory link (a junction on Windows: no admin rights needed). */
async function tryDirLink(target: string, link: string): Promise<boolean> {
  try {
    await fsp.mkdir(path.dirname(link), { recursive: true });
    await fsp.symlink(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
}

describe('NoteWriter.owned', () => {
  it('creates a note, then leaves an identical one alone, and counts what it produced', async () => {
    const writer = newWriter();
    const text = ownedNote('a');
    await writer.owned('AI Tool/Foundry/NPCs/Wolf.md', text, checkMarkdownOwnership);
    await writer.owned('AI Tool/Foundry/NPCs/Wolf.md', text, checkMarkdownOwnership);
    expect(writer.written).toEqual(['AI Tool/Foundry/NPCs/Wolf.md']);
    expect(writer.unchanged).toEqual(['AI Tool/Foundry/NPCs/Wolf.md']);
    expect(writer.producedCount).toBe(1);
    expect(await readIfThere(path.join(root, 'AI Tool/Foundry/NPCs/Wolf.md'))).toBe(text);

    // A fresh writer without the cache reads the file and finds it unchanged.
    const again = newWriter();
    await again.owned('AI Tool/Foundry/NPCs/Wolf.md', text, checkMarkdownOwnership);
    expect(again.unchanged).toEqual(['AI Tool/Foundry/NPCs/Wolf.md']);
    expect(again.written).toEqual([]);
  });

  it('skips a note the GM edited, and a foreign file, and lists both', async () => {
    const full = path.join(root, 'AI Tool/Foundry/NPCs/Wolf.md');
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, ownedNote('a').replace('Body', 'Body, edited'), 'utf8');
    const foreign = path.join(root, 'AI Tool/Foundry/NPCs/Bear.md');
    await fsp.writeFile(foreign, '# My own note\n', 'utf8');

    const writer = newWriter();
    await writer.owned('AI Tool/Foundry/NPCs/Wolf.md', ownedNote('b'), checkMarkdownOwnership);
    await writer.owned('AI Tool/Foundry/NPCs/Bear.md', ownedNote('b'), checkMarkdownOwnership);
    expect(writer.written).toEqual([]);
    expect(writer.skipped).toEqual([
      { path: 'AI Tool/Foundry/NPCs/Wolf.md', reason: 'edited in Obsidian' },
      { path: 'AI Tool/Foundry/NPCs/Bear.md', reason: 'not written by the AI Tool' },
    ]);
    expect(await readIfThere(foreign)).toBe('# My own note\n');
  });

  it('records a path outside the campaign folder as an error and writes nothing', async () => {
    const writer = newWriter();
    await writer.owned('../escape.md', ownedNote('a'), checkMarkdownOwnership);
    expect(writer.written).toEqual([]);
    expect(writer.errors).toHaveLength(1);
    expect(writer.errors[0]?.error).toMatch(/Refusing to write outside/);
    expect(await readIfThere(path.join(path.dirname(root), 'escape.md'))).toBeNull();
  });

  it('the same comparator leaves a note that differs only in what it ignores', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    const full = path.join(root, rel);
    const first = newWriter();
    await first.owned(rel, ownedNote('2026-01-01'), checkMarkdownOwnership);
    const onDisk = ownedNote('2026-01-01');

    const writer = newWriter();
    const same = vi.fn(ignoreModified);
    await writer.owned(rel, ownedNote('2026-02-02'), checkMarkdownOwnership, { same });
    expect(same).toHaveBeenCalledTimes(1);
    expect(same).toHaveBeenCalledWith(onDisk, ownedNote('2026-02-02'));
    expect(writer.written).toEqual([]);
    expect(writer.unchanged).toEqual([rel]);
    expect(await readIfThere(full)).toBe(onDisk); // not rewritten: the old timestamp stays

    // A real change is still written, with or without the comparator.
    await writer.owned(rel, ownedNote('2026-02-02', 'New body'), checkMarkdownOwnership, { same });
    expect(writer.written).toEqual([rel]);
    expect(await readIfThere(full)).toBe(ownedNote('2026-02-02', 'New body'));
  });

  it('without a comparator a timestamp-only change is written (O2 behavior)', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    await newWriter().owned(rel, ownedNote('2026-01-01'), checkMarkdownOwnership);
    const writer = newWriter();
    await writer.owned(rel, ownedNote('2026-02-02'), checkMarkdownOwnership);
    expect(writer.written).toEqual([rel]);
  });

  it('never asks the comparator about a note it may not touch, or one that is not there', async () => {
    const same = vi.fn(() => true);
    const edited = 'AI Tool/Foundry/NPCs/Edited.md';
    const full = path.join(root, edited);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, ownedNote('a').replace('Body', 'Mine'), 'utf8');
    const writer = newWriter();
    await writer.owned(edited, ownedNote('b'), checkMarkdownOwnership, { same });
    await writer.owned('AI Tool/Foundry/NPCs/New.md', ownedNote('b'), checkMarkdownOwnership, {
      same,
    });
    expect(same).not.toHaveBeenCalled();
    expect(writer.skipped.map(s => s.path)).toEqual([edited]);
    expect(writer.written).toEqual(['AI Tool/Foundry/NPCs/New.md']);
  });
});

describe('NoteWriter.assertRealFence', () => {
  it('accepts a normal tree, before and after the folders exist', async () => {
    const writer = newWriter();
    await expect(writer.assertRealFence('AI Tool/Foundry')).resolves.toBeUndefined(); // nothing exists yet
    await fsp.mkdir(path.join(root, 'AI Tool', 'Foundry', 'NPCs'), { recursive: true });
    await expect(writer.assertRealFence('AI Tool/Foundry')).resolves.toBeUndefined();
    await expect(writer.assertRealFence('AI Tool/Foundry/Scenes')).resolves.toBeUndefined();
    await expect(writer.assertRealFence('')).resolves.toBeUndefined();
  });

  it('refuses a folder outside the campaign folder', async () => {
    await expect(newWriter().assertRealFence('../other')).rejects.toThrow(
      /Refusing to write outside/
    );
  });

  it('refuses a junction inside the campaign folder that leads out of the vault', async ctx => {
    if (!(await tryDirLink(outside, path.join(root, 'AI Tool')))) return ctx.skip();
    await expect(newWriter().assertRealFence('AI Tool/Foundry')).rejects.toThrow(/leads outside/);
    // The write itself would have gone to the outside folder.
    expect(await fsp.readdir(outside)).toEqual([]);
  });

  it('refuses a junction that stays in the vault but leaves the campaign folder', async ctx => {
    const elsewhere = path.join(vault, 'Elsewhere');
    await fsp.mkdir(elsewhere, { recursive: true });
    if (!(await tryDirLink(elsewhere, path.join(root, 'AI Tool')))) return ctx.skip();
    await expect(newWriter().assertRealFence('AI Tool/Foundry')).rejects.toThrow(/leads outside/);
  });

  it('refuses a campaign folder that is itself a link out of the vault', async ctx => {
    if (!(await tryDirLink(outside, root))) return ctx.skip();
    await expect(newWriter().assertRealFence('AI Tool/Foundry')).rejects.toThrow(
      /leads outside the vault/
    );
  });

  it('accepts a link that stays inside the campaign folder', async ctx => {
    const inside = path.join(root, 'Elsewhere');
    await fsp.mkdir(inside, { recursive: true });
    if (!(await tryDirLink(inside, path.join(root, 'AI Tool')))) return ctx.skip();
    await expect(newWriter().assertRealFence('AI Tool/Foundry')).resolves.toBeUndefined();
  });

  it('refuses a link that leads nowhere (writing through it would create the target)', async ctx => {
    const missing = path.join(tmp, 'does-not-exist');
    if (!(await tryDirLink(missing, path.join(root, 'AI Tool')))) return ctx.skip();
    // Some platforms resolve such a link; only assert when the link really dangles.
    const dangles = await fsp.realpath(path.join(root, 'AI Tool')).then(
      () => false,
      () => true
    );
    if (!dangles) return ctx.skip();
    await expect(newWriter().assertRealFence('AI Tool/Foundry')).rejects.toThrow(/leads nowhere/);
  });
});

describe('NoteWriter.trash', () => {
  it('moves a note that is still ours to the vault .trash and lists it', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    const writer = newWriter();
    await writer.owned(rel, ownedNote('a'), checkMarkdownOwnership);

    expect(await writer.trash(rel, checkMarkdownOwnership)).toBe('trashed');
    expect(writer.trashed).toEqual([rel]);
    expect(await readIfThere(path.join(root, rel))).toBeNull();
    const target = path.join(vault, '.trash', 'Campaigns', WORLD, rel);
    expect(await readIfThere(target)).toBe(ownedNote('a'));
    expect(writer.skipped).toEqual([]);
    expect(writer.errors).toEqual([]);
  });

  it('numbers the trash copy when the name is taken', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    for (const modified of ['a', 'b']) {
      const writer = newWriter();
      await writer.owned(rel, ownedNote(modified), checkMarkdownOwnership);
      expect(await writer.trash(rel, checkMarkdownOwnership)).toBe('trashed');
    }
    const dir = path.join(vault, '.trash', 'Campaigns', WORLD, 'AI Tool/Foundry/NPCs');
    expect((await fsp.readdir(dir)).sort()).toEqual(['Wolf 1.md', 'Wolf.md']);
  });

  it('keeps a note the GM edited, and lists it as skipped', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const edited = ownedNote('a').replace('Body', 'Body, edited by the GM');
    await fsp.writeFile(full, edited, 'utf8');

    const writer = newWriter();
    expect(await writer.trash(rel, checkMarkdownOwnership)).toBe('kept');
    expect(writer.trashed).toEqual([]);
    expect(writer.skipped).toEqual([{ path: rel, reason: 'edited in Obsidian' }]);
    expect(await readIfThere(full)).toBe(edited);
  });

  it('keeps a foreign file', async () => {
    const rel = 'AI Tool/Foundry/NPCs/Wolf.md';
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, '# Mine\n', 'utf8');
    const writer = newWriter();
    expect(await writer.trash(rel, checkMarkdownOwnership)).toBe('kept');
    expect(writer.skipped).toEqual([{ path: rel, reason: 'not written by the AI Tool' }]);
  });

  it('returns missing for a note that is not there, and records nothing', async () => {
    const writer = newWriter();
    expect(await writer.trash('AI Tool/Foundry/NPCs/Gone.md', checkMarkdownOwnership)).toBe(
      'missing'
    );
    expect(writer.skipped).toEqual([]);
    expect(writer.errors).toEqual([]);
    expect(writer.trashed).toEqual([]);
  });

  it('keeps a folder and records a path outside the campaign folder as an error', async () => {
    await fsp.mkdir(path.join(root, 'AI Tool', 'Foundry', 'Folder.md'), { recursive: true });
    const writer = newWriter();
    expect(await writer.trash('AI Tool/Foundry/Folder.md', checkMarkdownOwnership)).toBe('kept');
    expect(writer.skipped.map(s => s.path)).toEqual(['AI Tool/Foundry/Folder.md']);
    expect(await writer.trash('../escape.md', checkMarkdownOwnership)).toBe('kept');
    expect(writer.errors).toHaveLength(1);
    expect(writer.errors[0]?.error).toMatch(/Refusing to write outside/);
  });

  it('does not touch a link to a note (the link is not the GM-owned note)', async ctx => {
    const target = path.join(outside, 'Real.md');
    await fsp.writeFile(target, ownedNote('a'), 'utf8');
    const link = path.join(root, 'AI Tool', 'Foundry', 'NPCs', 'Linked.md');
    await fsp.mkdir(path.dirname(link), { recursive: true });
    try {
      await fsp.symlink(target, link, 'file');
    } catch {
      return ctx.skip();
    }
    const writer = newWriter();
    expect(await writer.trash('AI Tool/Foundry/NPCs/Linked.md', checkMarkdownOwnership)).toBe(
      'kept'
    );
    expect(await readIfThere(target)).toBe(ownedNote('a'));
    expect(writer.trashed).toEqual([]);
  });
});
