import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureJournalFolder } from './journal-folder.js';

interface FakeFolder {
  id: string;
  name: string;
  type: string;
  folder: unknown;
  flags?: unknown;
}

let folders: FakeFolder[];
let create: ReturnType<typeof vi.fn>;

beforeEach(() => {
  folders = [
    { id: 'aaaaaaaaaaaaaaaa', name: 'Session notes', type: 'Actor', folder: null },
    { id: 'bbbbbbbbbbbbbbbb', name: 'Session notes', type: 'JournalEntry', folder: 'parent' },
  ];
  create = vi.fn((data: Record<string, unknown>) => {
    const made = { id: 'cccccccccccccccc', folder: null, ...data } as FakeFolder;
    folders.push(made);
    return Promise.resolve(made);
  });
  vi.stubGlobal('game', {
    folders: {
      get contents(): FakeFolder[] {
        return folders;
      },
      get: (id: string): FakeFolder | undefined => folders.find(f => f.id === id),
    },
  });
  vi.stubGlobal('Folder', { create });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ensureJournalFolder', () => {
  it('creates a top-level journal folder when only other types or nested ones match', async () => {
    const result = await ensureJournalFolder({ name: 'Session notes' });
    expect(result).toEqual({ folderId: 'cccccccccccccccc', created: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Session notes', type: 'JournalEntry' })
    );
  });

  it('reuses the top-level journal folder', async () => {
    folders.push({
      id: 'dddddddddddddddd',
      name: 'Session notes',
      type: 'JournalEntry',
      folder: null,
    });
    expect(await ensureJournalFolder({ name: 'Session notes' })).toEqual({
      folderId: 'dddddddddddddddd',
      created: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('fails when Foundry did not keep the folder', async () => {
    create.mockResolvedValueOnce({ id: 'eeeeeeeeeeeeeeee' });
    await expect(ensureJournalFolder({ name: 'Session notes' })).rejects.toThrow(
      'Foundry did not create'
    );
  });

  it('needs a name', async () => {
    await expect(ensureJournalFolder({})).rejects.toThrow('needs a folder name');
    await expect(ensureJournalFolder({ name: 'x'.repeat(101) })).rejects.toThrow();
  });
});
