import { describe, expect, it } from 'vitest';

import {
  playerFolder,
  playerSlug,
  portraitFileName,
  sniffType,
  uploadPlayerPortrait,
  type PortraitEnv,
  type PortraitPicker,
} from './player-portrait.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const USER = 'user000000000001';
const OTHER = 'user000000000002';
const GM = 'gmuser0000000001';
const MINE = 'actor00000000001';
const NOT_MINE = 'actor00000000002';
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

function env(): {
  e: PortraitEnv;
  uploads: Array<{ source: string; path: string; name: string; type: string }>;
  dirs: string[];
  setSwitch: (on: boolean) => void;
} {
  let switchOn = true;
  const uploads: Array<{ source: string; path: string; name: string; type: string }> = [];
  const dirs: string[] = [];
  const users: Record<string, { id: string; isGM?: boolean; name: string }> = {
    [USER]: { id: USER, name: 'Test Player 1' },
    [OTHER]: { id: OTHER, name: 'Other' },
    [GM]: { id: GM, name: 'GM', isGM: true },
  };
  const owners: Record<string, string> = { [MINE]: USER, [NOT_MINE]: OTHER };
  const e: PortraitEnv = {
    user: id => users[id],
    actor: id =>
      owners[id]
        ? {
            id,
            uuid: `Actor.${id}`,
            name: 'Brenna',
            type: id === 'npc0000000000001' ? 'npc' : 'character',
            testUserPermission: u => owners[id] === u.id,
          }
        : undefined,
    picker: () => ({
      createDirectory: (_s, target): Promise<void> => {
        dirs.push(target);
        return Promise.resolve();
      },
      upload: (source, path, file): Promise<unknown> => {
        uploads.push({ source, path, name: file.name, type: file.type });
        return Promise.resolve({ path: `${path}/${file.name}`, status: 'success' });
      },
    }),
    featureEnabled: () => switchOn,
    placedTokens: actorId =>
      actorId === MINE ? [`Scene.scene00000000001.Token.tok0000000001`] : [],
    now: () => new Date('2026-11-04T19:46:05Z'),
    random: () => 'abc12345',
  };
  return { e, uploads, dirs, setSwitch: (on: boolean) => (switchOn = on) };
}

describe('sniffType', () => {
  it('reads the type from the bytes', () => {
    expect(sniffType(PNG)).toBe('png');
    expect(sniffType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('jpg');
    const webp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ]);
    expect(sniffType(webp)).toBe('webp');
    expect(sniffType(new TextEncoder().encode('<svg xmlns="x"></svg>'))).toBeNull();
    expect(sniffType(new TextEncoder().encode('GIF89a......'))).toBeNull();
  });
});

describe('names', () => {
  it('makes a safe folder name and never an empty one', () => {
    expect(playerSlug('Test Player 1', USER)).toBe('test-player-1');
    expect(playerSlug('../../Évil  Name/', USER)).toBe('evil-name');
    expect(playerSlug('!!!', USER)).toBe(`player-${USER}`);
  });
  it('keeps two users with the same name apart by the user id', () => {
    expect(playerFolder('Test Player 1', USER)).toBe(`test-player-1-${USER}`);
    expect(playerFolder('Test Player 1', OTHER)).not.toBe(playerFolder('Test Player 1', USER));
    expect(playerFolder('!!!', USER)).toBe(`player-${USER}`);
  });
  it('makes the file name from the time and a random part', () => {
    expect(portraitFileName('png', new Date('2026-11-04T19:46:05Z'), 'abc12345')).toBe(
      'portrait-20261104194605-abc12345.png'
    );
  });
});

describe('uploadPlayerPortrait', () => {
  it('stores the picture in the player folder under a name it makes', async () => {
    const { e, uploads, dirs } = env();
    const reply = await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: b64(PNG) }, e);
    expect(reply).toMatchObject({
      success: true,
      path: `assets/players/test-player-1-${USER}/portrait-20261104194605-abc12345.png`,
      actorUuid: `Actor.${MINE}`,
      actorName: 'Brenna',
      userName: 'Test Player 1',
      placedTokens: ['Scene.scene00000000001.Token.tok0000000001'],
    });
    expect(dirs).toEqual(['assets', 'assets/players', `assets/players/test-player-1-${USER}`]);
    expect(uploads).toEqual([
      {
        source: 'data',
        path: `assets/players/test-player-1-${USER}`,
        name: 'portrait-20261104194605-abc12345.png',
        type: 'image/png',
      },
    ]);
  });

  it('refuses and stores nothing while the player-portrait switch is off', async () => {
    const { e, uploads, dirs, setSwitch } = env();
    setSwitch(false);
    const r = await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: b64(PNG) }, e);
    expect(r).toMatchObject({
      success: false,
      error: 'Changing your picture from this page is switched off. Ask your GM.',
    });
    expect(uploads).toEqual([]);
    expect(dirs).toEqual([]);
  });

  it('refuses a character the player does not own, an NPC and an unknown one, and stores nothing', async () => {
    const { e, uploads } = env();
    for (const actorId of [NOT_MINE, 'npc0000000000001', 'nosuch0000000000']) {
      const r = await uploadPlayerPortrait({ userId: USER, actorId, data: b64(PNG) }, e);
      expect(r.success).toBe(false);
    }
    expect(uploads).toEqual([]);
  });

  it('refuses the GM user and an unknown user', async () => {
    const { e, uploads } = env();
    for (const userId of [GM, 'nobody0000000000']) {
      const r = await uploadPlayerPortrait({ userId, actorId: MINE, data: b64(PNG) }, e);
      expect(r).toMatchObject({ success: false, error: 'No such player.' });
    }
    expect(uploads).toEqual([]);
  });

  it('refuses bad bytes, a bad type and oversized pictures; the client names no path', async () => {
    const { e, uploads } = env();
    const svg = b64(new TextEncoder().encode('<svg onload="x"></svg>'));
    expect(await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: svg }, e)).toMatchObject(
      { success: false, error: 'Only PNG, JPG or WebP pictures work.' }
    );
    expect(await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: '' }, e)).toMatchObject({
      success: false,
    });
    expect(
      await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: '***not base64' }, e)
    ).toMatchObject({ success: false });
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(PNG);
    expect(
      await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: b64(big) }, e)
    ).toMatchObject({ success: false, error: 'That picture is too big. The limit is 5 MB.' });
    // A path or name sent by the client is ignored: the module never reads one.
    const r = await uploadPlayerPortrait(
      { userId: USER, actorId: MINE, data: b64(PNG), path: '../../x', name: '../evil.png' },
      e
    );
    expect(r.success).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toBe(`assets/players/test-player-1-${USER}`);
    expect(uploads[0].name).toMatch(/^portrait-\d{14}-[a-z0-9]{8}\.png$/);
  });

  it('says so when Foundry does not accept the upload', async () => {
    const { e } = env();
    e.picker = (): PortraitPicker => ({
      createDirectory: (): Promise<void> => Promise.resolve(),
      upload: (): Promise<unknown> => Promise.resolve(false),
    });
    const r = await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: b64(PNG) }, e);
    expect(r.success).toBe(false);
  });

  it('treats Foundry failure replies without a path as a failed upload', async () => {
    for (const reply of [{}, undefined, { status: 'success' }]) {
      const { e } = env();
      e.picker = (): PortraitPicker => ({
        createDirectory: (): Promise<void> => Promise.resolve(),
        upload: (): Promise<unknown> => Promise.resolve(reply),
      });
      const r = await uploadPlayerPortrait({ userId: USER, actorId: MINE, data: b64(PNG) }, e);
      expect(r.success).toBe(false);
    }
  });
});
