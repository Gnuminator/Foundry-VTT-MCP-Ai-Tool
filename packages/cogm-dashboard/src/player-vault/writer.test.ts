import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Logger } from '../logger.js';
import { PLAYER_MARKER_FILE, writePlayerVault } from './writer.js';

const logger = new Logger('error');
const ALICE = { userId: 'aliceAliceAlice01', name: 'Alice' };

let root: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'player-vault-'));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

async function listAll(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listAll(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

describe('writePlayerVault', () => {
  it('writes the files and the marker, creating subfolders and the root', async () => {
    const nested = path.join(root, 'deep', 'vaults');
    const folder = await writePlayerVault(
      nested,
      ALICE,
      files({
        'Home.md': '# Home\n',
        'Handouts/Letter.md': 'Dear Alice',
        '.obsidian/app.json': '{}',
      }),
      logger
    );
    expect(folder).toBe(path.join(nested, 'Alice'));
    expect(await listAll(folder)).toEqual([
      PLAYER_MARKER_FILE,
      '.obsidian/app.json',
      'Handouts/Letter.md',
      'Home.md',
    ]);
    expect(await fsp.readFile(path.join(folder, 'Handouts', 'Letter.md'), 'utf8')).toBe(
      'Dear Alice'
    );
    const marker = JSON.parse(await fsp.readFile(path.join(folder, PLAYER_MARKER_FILE), 'utf8'));
    expect(marker).toEqual({
      userId: ALICE.userId,
      name: 'Alice',
      generatedBy: 'foundry-ai-tool',
      schema: 2,
      files: ['.obsidian/app.json', 'Handouts/Letter.md', 'Home.md'],
    });
  });

  it('writes utf8 content', async () => {
    const folder = await writePlayerVault(root, ALICE, files({ 'a.md': 'Blåbærgrød æøå' }), logger);
    expect(await fsp.readFile(path.join(folder, 'a.md'), 'utf8')).toBe('Blåbærgrød æøå');
  });

  it('replaces old content fully and leaves no temp files or old folders', async () => {
    await writePlayerVault(
      root,
      ALICE,
      files({ 'Old.md': 'old', 'keep.md': 'v1', 'd/x.md': 'x' }),
      logger
    );
    const folder = await writePlayerVault(
      root,
      ALICE,
      files({ 'keep.md': 'v2', 'New.md': 'new' }),
      logger
    );
    expect(await listAll(folder)).toEqual([PLAYER_MARKER_FILE, 'New.md', 'keep.md']);
    expect(await fsp.readFile(path.join(folder, 'keep.md'), 'utf8')).toBe('v2');
    expect(await fsp.readdir(root)).toEqual(['Alice']);
  });

  it('uses the same folder again for the same user', async () => {
    const a = await writePlayerVault(root, ALICE, files({ 'a.md': '1' }), logger);
    const b = await writePlayerVault(root, ALICE, files({ 'a.md': '2' }), logger);
    expect(b).toBe(a);
  });

  it('refuses a folder that is not ours and leaves it alone', async () => {
    const foreign = path.join(root, 'Alice');
    await fsp.mkdir(foreign);
    await fsp.writeFile(path.join(foreign, 'mine.txt'), 'precious');
    await expect(writePlayerVault(root, ALICE, files({ 'a.md': 'x' }), logger)).rejects.toThrow(
      /"Alice"/
    );
    expect(await fsp.readFile(path.join(foreign, 'mine.txt'), 'utf8')).toBe('precious');
    expect(await fsp.readdir(foreign)).toEqual(['mine.txt']);
    expect(await fsp.readdir(root)).toEqual(['Alice']);
  });

  it('refuses a plain file with the folder name', async () => {
    await fsp.writeFile(path.join(root, 'Alice'), 'a file');
    await expect(writePlayerVault(root, ALICE, files({ 'a.md': 'x' }), logger)).rejects.toThrow(
      /"Alice"/
    );
    expect(await fsp.readFile(path.join(root, 'Alice'), 'utf8')).toBe('a file');
  });

  it('refuses a folder whose marker is not ours', async () => {
    const foreign = path.join(root, 'Alice');
    await fsp.mkdir(foreign);
    await fsp.writeFile(
      path.join(foreign, PLAYER_MARKER_FILE),
      JSON.stringify({ userId: ALICE.userId, generatedBy: 'someone else' })
    );
    await expect(writePlayerVault(root, ALICE, files({ 'a.md': 'x' }), logger)).rejects.toThrow(
      /not ours/
    );
  });

  it('adds a user id fragment on a name collision with another user', async () => {
    const first = await writePlayerVault(root, ALICE, files({ 'a.md': 'alice' }), logger);
    const other = { userId: 'zed123456789abcd', name: 'Alice' };
    const second = await writePlayerVault(root, other, files({ 'a.md': 'other' }), logger);
    expect(first).toBe(path.join(root, 'Alice'));
    expect(second).toBe(path.join(root, 'Alice (zed123)'));
    expect(await fsp.readFile(path.join(first, 'a.md'), 'utf8')).toBe('alice');
    expect(await fsp.readFile(path.join(second, 'a.md'), 'utf8')).toBe('other');

    // Writing the second user again keeps using the suffixed folder.
    const again = await writePlayerVault(root, other, files({ 'b.md': 'again' }), logger);
    expect(again).toBe(second);
    expect(await listAll(again)).toEqual([PLAYER_MARKER_FILE, 'b.md']);
    expect(await fsp.readdir(root).then(names => names.sort())).toEqual([
      'Alice',
      'Alice (zed123)',
    ]);
  });

  it('makes the folder name safe', async () => {
    const folder = await writePlayerVault(
      root,
      { userId: 'u1u1u1u1u1u1u1u1', name: '../Evil: name?' },
      files({ 'a.md': 'x' }),
      logger
    );
    expect(path.dirname(folder)).toBe(root);
    expect(path.basename(folder)).toBe('Evil name');
  });

  it('rejects unsafe paths before writing anything', async () => {
    const unsafe = [
      '../x.md',
      'a/../../x.md',
      '/abs.md',
      'C:/x.md',
      'a\\b.md',
      'a//b.md',
      './x.md',
      '',
      PLAYER_MARKER_FILE,
    ];
    for (const bad of unsafe) {
      await expect(
        writePlayerVault(root, ALICE, files({ 'ok.md': 'x', [bad]: 'y' }), logger)
      ).rejects.toThrow(/player vault/i);
    }
    await expect(
      writePlayerVault(root, ALICE, files({ [path.resolve(root, 'abs.md')]: 'y' }), logger)
    ).rejects.toThrow(/Unsafe/);
    expect(await fsp.readdir(root)).toEqual([]);
  });

  it('keeps the old vault when a new one fails to build', async () => {
    await writePlayerVault(root, ALICE, files({ 'a.md': 'v1' }), logger);
    await expect(
      writePlayerVault(root, ALICE, files({ 'a.md': 'v2', '../x.md': 'bad' }), logger)
    ).rejects.toThrow();
    expect(await fsp.readFile(path.join(root, 'Alice', 'a.md'), 'utf8')).toBe('v1');
    expect(await fsp.readdir(root)).toEqual(['Alice']);
  });

  it('refuses a map that needs a folder where it has a file, before writing anything', async () => {
    // A file path that needs a folder where the map has a file: "a" then "a/b".
    await expect(
      writePlayerVault(root, ALICE, files({ a: 'file', 'a/b.md': 'nested' }), logger)
    ).rejects.toThrow();
    expect(await fsp.readdir(root)).toEqual([]);
  });
});

describe('writePlayerVault in place (Syncthing)', () => {
  it('keeps the folder itself and the Syncthing files over two rebuilds', async () => {
    const folder = await writePlayerVault(root, ALICE, files({ 'Home.md': 'v1' }), logger);
    // What Syncthing puts in a shared folder: a marker folder, an ignore file, old versions.
    await fsp.mkdir(path.join(folder, '.stfolder'));
    await fsp.writeFile(path.join(folder, '.stignore'), '*.tmp\n');
    await fsp.mkdir(path.join(folder, '.stversions', 'Handouts'), { recursive: true });
    await fsp.writeFile(path.join(folder, '.stversions', 'Handouts', 'old.md'), 'old');
    const before = await fsp.stat(folder);

    await writePlayerVault(root, ALICE, files({ 'Home.md': 'v2', 'New.md': 'n' }), logger);
    await writePlayerVault(root, ALICE, files({ 'Home.md': 'v3' }), logger);

    const after = await fsp.stat(folder);
    expect(after.ino).toBe(before.ino);
    expect(after.birthtimeMs).toBe(before.birthtimeMs);
    expect((await fsp.stat(path.join(folder, '.stfolder'))).isDirectory()).toBe(true);
    expect(await fsp.readFile(path.join(folder, '.stignore'), 'utf8')).toBe('*.tmp\n');
    expect(await fsp.readFile(path.join(folder, '.stversions', 'Handouts', 'old.md'), 'utf8')).toBe(
      'old'
    );
    expect(await fsp.readFile(path.join(folder, 'Home.md'), 'utf8')).toBe('v3');
    expect(await listAll(folder)).toEqual([
      PLAYER_MARKER_FILE,
      '.stignore',
      '.stversions/Handouts/old.md',
      'Home.md',
    ]);
    expect(await fsp.readdir(root)).toEqual(['Alice']);
  });

  it('does not rewrite unchanged files (their mtime stays), rewrites changed ones', async () => {
    const folder = await writePlayerVault(
      root,
      ALICE,
      files({ 'same.md': 'same', 'changes.md': 'v1' }),
      logger
    );
    const old = new Date(Date.now() - 60_000);
    for (const f of ['same.md', 'changes.md', PLAYER_MARKER_FILE]) {
      await fsp.utimes(path.join(folder, f), old, old);
    }
    const mtime = async (f: string): Promise<number> =>
      (await fsp.stat(path.join(folder, f))).mtimeMs;
    const sameBefore = await mtime('same.md');
    const markerBefore = await mtime(PLAYER_MARKER_FILE);

    await writePlayerVault(root, ALICE, files({ 'same.md': 'same', 'changes.md': 'v2' }), logger);
    expect(await mtime('same.md')).toBe(sameBefore);
    expect(await mtime(PLAYER_MARKER_FILE)).toBe(markerBefore);
    expect(await mtime('changes.md')).toBeGreaterThan(sameBefore);
    expect(await fsp.readFile(path.join(folder, 'changes.md'), 'utf8')).toBe('v2');
    // No temp files are left next to the notes.
    expect(await listAll(folder)).toEqual([PLAYER_MARKER_FILE, 'changes.md', 'same.md']);
  });

  it('deletes notes that left the map and the folders they leave empty', async () => {
    const folder = await writePlayerVault(
      root,
      ALICE,
      files({ 'Home.md': 'h', 'Handouts/A.md': 'a', 'Log/2026/S1.md': 's' }),
      logger
    );
    await writePlayerVault(root, ALICE, files({ 'Home.md': 'h' }), logger);
    expect(await listAll(folder)).toEqual([PLAYER_MARKER_FILE, 'Home.md']);
    expect((await fsp.readdir(folder)).sort()).toEqual([PLAYER_MARKER_FILE, 'Home.md']);
    const marker = JSON.parse(await fsp.readFile(path.join(folder, PLAYER_MARKER_FILE), 'utf8'));
    expect(marker.files).toEqual(['Home.md']);
  });

  it('keeps files and folders the GM or the player put there', async () => {
    const folder = await writePlayerVault(
      root,
      ALICE,
      files({ 'Home.md': 'h', 'Handouts/A.md': 'a' }),
      logger
    );
    await fsp.writeFile(path.join(folder, 'My notes.md'), 'mine');
    await fsp.writeFile(path.join(folder, 'Handouts', 'Player sketch.md'), 'sketch');
    await fsp.mkdir(path.join(folder, 'Empty by player'));

    await writePlayerVault(root, ALICE, files({ 'Home.md': 'h2' }), logger);
    expect(await fsp.readFile(path.join(folder, 'My notes.md'), 'utf8')).toBe('mine');
    expect(await fsp.readFile(path.join(folder, 'Handouts', 'Player sketch.md'), 'utf8')).toBe(
      'sketch'
    );
    expect((await fsp.stat(path.join(folder, 'Empty by player'))).isDirectory()).toBe(true);
    expect(await listAll(folder)).toEqual([
      PLAYER_MARKER_FILE,
      'Handouts/Player sketch.md',
      'Home.md',
      'My notes.md',
    ]);
  });

  it('keeps a note whose name changed only in case', async () => {
    const folder = await writePlayerVault(root, ALICE, files({ 'letter.md': 'x' }), logger);
    await writePlayerVault(root, ALICE, files({ 'Letter.md': 'y' }), logger);
    const names = (await fsp.readdir(folder)).filter(n => n.toLowerCase() === 'letter.md');
    expect(names).toHaveLength(1);
    expect(await fsp.readFile(path.join(folder, names[0]), 'utf8')).toBe('y');
  });

  it('refuses Syncthing names in the file map', async () => {
    for (const bad of ['.stignore', '.stfolder/x', 'a/.stversions/b.md']) {
      await expect(writePlayerVault(root, ALICE, files({ [bad]: 'x' }), logger)).rejects.toThrow(
        /Syncthing/
      );
    }
    expect(await fsp.readdir(root)).toEqual([]);
  });
});
