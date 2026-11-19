import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VaultStore } from '../vault/store.js';
import { OmensStore, handleOmensControl } from './store.js';

const ANNA = 'aaaaaaaaaaaaaaaa';
const BO = 'bbbbbbbbbbbbbbbb';
const DISCORD_ANNA = '123456789012345678';

let dataDir: string;
let omens: OmensStore;
let counter: number;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omens-'));
  counter = 0;
  omens = new OmensStore({
    store: new VaultStore({ dataDir }),
    worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
    newId: (): string => `id${++counter}`,
    findSecretTerms: async (_world, text): Promise<string[]> =>
      /Vallaki/i.test(text) ? ['Vallaki'] : [],
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('omens by post', () => {
  it('drafts start as drafts and are not in the outbox', async () => {
    const { id, omen } = await omens.add(ANNA, '  A raven watches you.  ');
    expect(omen.status).toBe('draft');
    expect(omen.text).toBe('A raven watches you.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    expect(await omens.outbox()).toEqual([]);
    expect((await omens.list()).omens.map(o => o.id)).toEqual([id]);
  });

  it('sends only approved omens, to the linked player only', async () => {
    const a = await omens.add(ANNA, 'For Anna.');
    await omens.add(BO, 'For Bo.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    await omens.decide(a.id, 'approve');
    expect(await omens.outbox()).toEqual([
      { id: a.id, userId: ANNA, discordId: DISCORD_ANNA, text: 'For Anna.' },
    ]);
  });

  it('an approved omen without a Discord link is not sent and cannot be claimed', async () => {
    const b = await omens.add(BO, 'For Bo.');
    await omens.decide(b.id, 'approve');
    expect(await omens.outbox()).toEqual([]);
    expect(await omens.claim(b.id)).toBeNull();
  });

  it('claims once: a second claim gets nothing, so no double send', async () => {
    const a = await omens.add(ANNA, 'For Anna.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    await omens.decide(a.id, 'approve');
    expect((await omens.claim(a.id))?.discordId).toBe(DISCORD_ANNA);
    expect(await omens.claim(a.id)).toBeNull();
    expect(await omens.outbox()).toEqual([]);
    await omens.finish(a.id, true);
    const sent = (await omens.list()).omens[0];
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeDefined();
  });

  it('a failed send goes back to approved', async () => {
    const a = await omens.add(ANNA, 'For Anna.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    await omens.decide(a.id, 'approve');
    await omens.claim(a.id);
    await omens.finish(a.id, false);
    expect((await omens.outbox()).length).toBe(1);
  });

  it('editing an approved omen puts it back to draft', async () => {
    const a = await omens.add(ANNA, 'One.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    await omens.decide(a.id, 'approve');
    const edited = await omens.edit(a.id, 'Two.');
    expect(edited.status).toBe('draft');
    expect(await omens.outbox()).toEqual([]);
  });

  it('a sending or sent omen cannot be edited, removed or reapproved', async () => {
    const a = await omens.add(ANNA, 'One.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    await omens.decide(a.id, 'approve');
    await omens.claim(a.id);
    await expect(omens.edit(a.id, 'Two.')).rejects.toThrow(/cannot be edited/);
    await expect(omens.remove(a.id)).rejects.toThrow(/reopen/);
    await expect(omens.decide(a.id, 'approve')).rejects.toThrow(/already sending/);
    await omens.finish(a.id, true);
    await expect(omens.decide(a.id, 'reopen')).rejects.toThrow(/sent/);
  });

  it('flags secret terms and needs a confirmation to approve', async () => {
    const a = await omens.add(ANNA, 'You dream of Vallaki.');
    expect(a.omen.secretTerms).toEqual(['Vallaki']);
    await expect(omens.decide(a.id, 'approve')).rejects.toThrow(/confirm/);
    expect((await omens.decide(a.id, 'approve', true)).status).toBe('approved');
  });

  it('rejects bad input', async () => {
    await expect(omens.add('nope', 'x')).rejects.toThrow(/user id/);
    await expect(omens.add(ANNA, '   ')).rejects.toThrow(/empty/);
    await expect(omens.add(ANNA, 'x'.repeat(1501))).rejects.toThrow(/too long/);
    await expect(omens.setPlayer(ANNA, 'not-a-snowflake')).rejects.toThrow(/Discord/);
  });

  it('the control method has no way to send without an approval', async () => {
    const a = await omens.add(ANNA, 'One.');
    await omens.setPlayer(ANNA, DISCORD_ANNA);
    expect(await handleOmensControl(omens, { action: 'claim', id: a.id })).toEqual({ item: null });
    await expect(handleOmensControl(omens, { action: 'bogus' })).rejects.toThrow(/Unknown/);
  });
});
