import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VaultStore } from '../vault/store.js';
import { DraftsStore, draftChatPost, handleDraftsControl, type DraftPost } from './store.js';

let dataDir: string;
let drafts: DraftsStore;
let counter: number;
let posts: DraftPost[];
let failPost: boolean;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drafts-'));
  counter = 0;
  posts = [];
  failPost = false;
  drafts = new DraftsStore({
    store: new VaultStore({ dataDir }),
    worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
    newId: (): string => `id${++counter}`,
    findSecretTerms: async (_world, text): Promise<string[]> =>
      /Vallaki/i.test(text) ? ['Vallaki'] : [],
    post: async (post): Promise<void> => {
      if (failPost) throw new Error('GM client not joined');
      posts.push(post);
    },
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('draft tray', () => {
  it('starts a draft in the tray and posts nothing', async () => {
    const { id, draft } = await drafts.add({ kind: 'read-aloud', text: '  The fog thickens.  ' });
    expect(draft.status).toBe('draft');
    expect(draft.text).toBe('The fog thickens.');
    expect(posts).toEqual([]);
    expect((await drafts.list()).drafts.map(d => d.id)).toEqual([id]);
  });

  it('rejects an unknown kind and empty or overlong text', async () => {
    await expect(drafts.add({ kind: 'poem', text: 'x' })).rejects.toThrow('kind must be');
    await expect(drafts.add({ kind: 'recap', text: '   ' })).rejects.toThrow('empty');
    await expect(drafts.add({ kind: 'recap', text: 'x'.repeat(4001) })).rejects.toThrow('too long');
  });

  it('flags secret terms on add and edit', async () => {
    const { id, draft } = await drafts.add({ kind: 'letter', text: 'Meet me in Vallaki.' });
    expect(draft.secretTerms).toEqual(['Vallaki']);
    const edited = await drafts.edit(id, { text: 'Meet me at the mill.' });
    expect(edited.secretTerms).toBeUndefined();
  });

  it('publishes to chat once, as everyone or a whisper', async () => {
    const a = await drafts.add({ kind: 'read-aloud', text: 'Mist.' });
    const b = await drafts.add({
      kind: 'npc-line',
      text: 'Welcome.',
      speaker: 'Ireena',
      whisperTo: 'Anna',
    });
    const published = await drafts.publish(a.id);
    expect(published.status).toBe('published');
    await drafts.publish(b.id);
    expect(posts).toEqual([
      { message: 'Mist.' },
      { message: 'Welcome.', speakerActorName: 'Ireena', whisperTargets: ['Anna'] },
    ]);
    await expect(drafts.publish(a.id)).rejects.toThrow('is published');
    expect(posts).toHaveLength(2);
  });

  it('a flagged draft needs the confirm, and is checked again at publish time', async () => {
    const { id } = await drafts.add({ kind: 'recap', text: 'Fine for now.' });
    const free = new DraftsStore({
      store: new VaultStore({ dataDir }),
      worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
      newId: (): string => 'x',
      findSecretTerms: async (): Promise<string[]> => ['Strahd'],
      post: async (post): Promise<void> => {
        posts.push(post);
      },
    });
    await expect(free.publish(id)).rejects.toThrow('confirm to publish');
    expect(posts).toEqual([]);
    expect((await free.list()).drafts[0]?.secretTerms).toEqual(['Strahd']);
    await free.publish(id, true);
    expect(posts).toHaveLength(1);
  });

  it('a failed post puts the draft back with the reason', async () => {
    const { id } = await drafts.add({ kind: 'read-aloud', text: 'Mist.' });
    failPost = true;
    await expect(drafts.publish(id)).rejects.toThrow('GM client not joined');
    const [draft] = (await drafts.list()).drafts;
    expect(draft?.status).toBe('draft');
    expect(draft?.lastError).toBe('GM client not joined');
    failPost = false;
    await drafts.publish(id);
    expect(posts).toHaveLength(1);
  });

  it('discards, reopens and removes; a published draft stays', async () => {
    const a = await drafts.add({ kind: 'letter', text: 'Dear X.' });
    await drafts.discard(a.id);
    await expect(drafts.edit(a.id, { text: 'y' })).rejects.toThrow('cannot be edited');
    expect((await drafts.reopen(a.id)).status).toBe('draft');
    await drafts.remove(a.id);
    expect((await drafts.list()).drafts).toEqual([]);
    const b = await drafts.add({ kind: 'recap', text: 'Done.' });
    await drafts.publish(b.id);
    await expect(drafts.remove(b.id)).rejects.toThrow('cannot be removed');
    await expect(drafts.reopen(b.id)).rejects.toThrow('cannot be reopened');
  });

  it('shapes the chat post: letters sign, NPC lines speak', () => {
    const base = { text: 'T', status: 'draft' as const, createdAt: 'now' };
    expect(draftChatPost({ ...base, kind: 'letter', speaker: 'Ismark' }).message).toBe(
      'T\n\nIsmark'
    );
    expect(draftChatPost({ ...base, kind: 'npc-line', speaker: 'Ismark' }).speakerActorName).toBe(
      'Ismark'
    );
    expect(draftChatPost({ ...base, kind: 'recap' })).toEqual({ message: 'T' });
  });

  it('the control method has no way to add drafts', async () => {
    await expect(handleDraftsControl(drafts, { action: 'add' })).rejects.toThrow('Unknown');
    expect(await handleDraftsControl(drafts, { action: 'list' })).toEqual({ drafts: [] });
  });
});
