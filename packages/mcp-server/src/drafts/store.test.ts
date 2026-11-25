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
let failMessage = 'GM client not joined';

/** What the dashboard sends: the version and flags the GM was shown. */
async function seen(id: string): Promise<{ rev: number; confirmedTerms: string[] }> {
  const draft = (await drafts.list()).drafts.find(d => d.id === id);
  return { rev: draft?.rev ?? 0, confirmedTerms: draft?.secretTerms ?? [] };
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drafts-'));
  counter = 0;
  posts = [];
  failPost = false;
  failMessage = 'GM client not joined';
  drafts = new DraftsStore({
    store: new VaultStore({ dataDir }),
    worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
    newId: (): string => `id${++counter}`,
    findSecretTerms: async (_world, text): Promise<string[]> =>
      /Vallaki/i.test(text) ? ['Vallaki'] : [],
    post: async (post): Promise<void> => {
      if (failPost) throw new Error(failMessage);
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
    const published = await drafts.publish(a.id, await seen(a.id));
    expect(published.status).toBe('published');
    await drafts.publish(b.id, await seen(b.id));
    expect(posts).toEqual([
      { message: '<p>Mist.</p>' },
      { message: '<p><strong>Ireena</strong></p><p>Welcome.</p>', whisperTargets: ['Anna'] },
    ]);
    await expect(drafts.publish(a.id, { rev: 1 })).rejects.toThrow('is published');
    expect(posts).toHaveLength(2);
  });

  it('refuses a publish of a version the GM did not read (Claude edited meanwhile)', async () => {
    const { id } = await drafts.add({ kind: 'npc-line', text: 'Hello.', whisperTo: 'Anna' });
    const read = await seen(id);
    await drafts.edit(id, { text: 'Something else.', whisperTo: '' });
    await expect(drafts.publish(id, read)).rejects.toThrow('changed since you read it');
    await expect(drafts.publish(id, {})).rejects.toThrow('changed since you read it');
    expect(posts).toEqual([]);
    await drafts.publish(id, await seen(id));
    expect(posts).toEqual([{ message: '<p>Something else.</p>' }]);
  });

  it('a term first found at publish time is not covered by an older confirm', async () => {
    const { id } = await drafts.add({ kind: 'recap', text: 'Fine for now.' });
    let terms = ['Strahd'];
    const live = new DraftsStore({
      store: new VaultStore({ dataDir }),
      worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
      newId: (): string => 'x',
      findSecretTerms: async (): Promise<string[]> => terms,
      post: async (post): Promise<void> => {
        posts.push(post);
      },
    });
    await expect(live.publish(id, { rev: 1, confirmedTerms: ['Vallaki'] })).rejects.toThrow(
      'confirm to publish'
    );
    expect((await live.list()).drafts[0]?.secretTerms).toEqual(['Strahd']);
    terms = ['Strahd', 'Ireena'];
    await expect(live.publish(id, { rev: 1, confirmedTerms: ['Strahd'] })).rejects.toThrow(
      'Ireena'
    );
    await live.publish(id, { rev: 1, confirmedTerms: ['Strahd', 'Ireena'] });
    expect(posts).toHaveLength(1);
  });

  it('a lost answer keeps the draft out of publish again; a refusal puts it back', async () => {
    const { id } = await drafts.add({ kind: 'read-aloud', text: 'Mist.' });
    failMessage = 'Query timeout';
    failPost = true;
    await expect(drafts.publish(id, await seen(id))).rejects.toThrow('may be in chat');
    const [draft] = (await drafts.list()).drafts;
    expect(draft?.status).toBe('publishing');
    await expect(drafts.publish(id, { rev: 1 })).rejects.toThrow('is publishing');
    await expect(drafts.reopen(id)).rejects.toThrow('check the chat log');
    expect((await drafts.reopen(id, true)).status).toBe('draft');
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
    await expect(free.publish(id, { rev: 1 })).rejects.toThrow('confirm to publish');
    expect(posts).toEqual([]);
    expect((await free.list()).drafts[0]?.secretTerms).toEqual(['Strahd']);
    await free.publish(id, { rev: 1, confirmedTerms: ['Strahd'] });
    expect(posts).toHaveLength(1);
  });

  it('a failed post puts the draft back with the reason', async () => {
    const { id } = await drafts.add({ kind: 'read-aloud', text: 'Mist.' });
    failPost = true;
    await expect(drafts.publish(id, await seen(id))).rejects.toThrow('GM client not joined');
    const [draft] = (await drafts.list()).drafts;
    expect(draft?.status).toBe('draft');
    expect(draft?.lastError).toBe('GM client not joined');
    failPost = false;
    await drafts.publish(id, await seen(id));
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
    await drafts.publish(b.id, await seen(b.id));
    await expect(drafts.remove(b.id)).rejects.toThrow('cannot be removed');
    await expect(drafts.reopen(b.id)).rejects.toThrow('cannot be reopened');
  });

  it('shapes the chat post as escaped HTML: letters sign, NPC lines name the speaker', () => {
    const base = { text: 'T', status: 'draft' as const, createdAt: 'now' };
    expect(draftChatPost({ ...base, kind: 'letter', speaker: 'Ismark' }).message).toBe(
      '<p>T</p><p><em>Ismark</em></p>'
    );
    expect(draftChatPost({ ...base, kind: 'npc-line', speaker: 'Ismark' })).toEqual({
      message: '<p><strong>Ismark</strong></p><p>T</p>',
    });
    expect(draftChatPost({ ...base, kind: 'recap' })).toEqual({ message: '<p>T</p>' });
    expect(
      draftChatPost({ ...base, kind: 'read-aloud', text: 'One <b>& two\nthree\n\nFour' }).message
    ).toBe('<p>One &lt;b&gt;&amp; two<br>three</p><p>Four</p>');
  });

  it('the control method has no way to add drafts', async () => {
    await expect(handleDraftsControl(drafts, { action: 'add' })).rejects.toThrow('Unknown');
    expect(await handleDraftsControl(drafts, { action: 'list' })).toEqual({ drafts: [] });
  });
});
