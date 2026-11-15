import { describe, expect, it } from 'vitest';

import {
  actorFolderName,
  artFileName,
  findActor,
  uploadActorImage,
  type ActorImageEnv,
  type ImageActor,
} from './actor-image.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

const ACTORS: ImageActor[] = [
  {
    id: 'actor00000000001',
    name: 'Ebbe Thistlebottom',
    img: 'icons/old.webp',
    prototypeToken: { texture: { src: 'icons/oldtoken.webp' } },
  },
  { id: 'actor00000000002', name: 'Twin' },
  { id: 'actor00000000003', name: 'Twin' },
];

function env(): {
  e: ActorImageEnv;
  uploads: Array<{ path: string; name: string }>;
  dirs: string[];
} {
  const uploads: Array<{ path: string; name: string }> = [];
  const dirs: string[] = [];
  const e: ActorImageEnv = {
    enabled: () => true,
    actors: () => ACTORS,
    picker: () => ({
      createDirectory: (_s, target): Promise<void> => {
        dirs.push(target);
        return Promise.resolve();
      },
      upload: (_s, path, file): Promise<unknown> => {
        uploads.push({ path, name: file.name });
        return Promise.resolve({ path: `${path}/${file.name}`, status: 'success' });
      },
    }),
    now: () => new Date('2026-11-10T20:30:15Z'),
    random: () => 'abcd1234',
  };
  return { e, uploads, dirs };
}

describe('findActor', () => {
  it('finds by id, by exact name and refuses an unknown or twin name', () => {
    expect(findActor(ACTORS, 'actor00000000001')).toEqual({ actor: ACTORS[0] });
    expect(findActor(ACTORS, ' ebbe thistlebottom ')).toEqual({ actor: ACTORS[0] });
    expect(findActor(ACTORS, 'Twin')).toHaveProperty('error');
    expect(findActor(ACTORS, 'Nobody')).toHaveProperty('error');
  });
});

describe('artFileName', () => {
  it('is made from the time and a random part', () => {
    expect(artFileName('webp', new Date('2026-11-10T20:30:15Z'), 'abcd1234')).toBe(
      'art-20261110203015-abcd1234.webp'
    );
  });
});

describe('actorFolderName', () => {
  it('is the name slug and the id, and actor-<id> when the name has no letters or digits', () => {
    expect(actorFolderName('Ebbe Thistlebottom', 'ACTOR1')).toBe('ebbe-thistlebottom-actor1');
    expect(actorFolderName('???', 'ACTOR1')).toBe('actor-actor1');
    expect(actorFolderName('', 'ACTOR1')).toBe('actor-actor1');
  });
});

describe('uploadActorImage', () => {
  it('refuses on its own when the Actor images switch is off, before any folder or upload', async () => {
    const { e, uploads, dirs } = env();
    const reply = await uploadActorImage(
      { actor: 'Ebbe Thistlebottom', data: b64(PNG) },
      { ...e, enabled: () => false }
    );
    expect(reply).toMatchObject({ success: false });
    expect((reply as { error: string }).error).toMatch(/switched off/);
    expect(uploads).toEqual([]);
    expect(dirs).toEqual([]);
  });

  it('stores the picture in the actor folder under a made-up name and reports the old paths', async () => {
    const { e, uploads, dirs } = env();
    const reply = await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: b64(PNG) }, e);
    const folder = 'assets/ai-art/ebbe-thistlebottom-actor00000000001';
    expect(reply).toEqual({
      success: true,
      path: `${folder}/art-20261110203015-abcd1234.png`,
      actorId: 'actor00000000001',
      actorName: 'Ebbe Thistlebottom',
      currentImg: 'icons/old.webp',
      currentTokenImg: 'icons/oldtoken.webp',
    });
    expect(uploads).toEqual([{ path: folder, name: 'art-20261110203015-abcd1234.png' }]);
    expect(dirs).toEqual(['assets', 'assets/ai-art', folder]);
  });

  it('refuses a missing actor, a non-picture, an oversized or malformed body, a twin name', async () => {
    const { e, uploads } = env();
    const text = b64(Uint8Array.from([104, 105, 104, 105]));
    expect(await uploadActorImage({ actor: 'Nobody', data: b64(PNG) }, e)).toMatchObject({
      success: false,
    });
    expect(await uploadActorImage({ actor: 'Twin', data: b64(PNG) }, e)).toMatchObject({
      success: false,
    });
    expect(await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: text }, e)).toMatchObject({
      success: false,
      error: 'Only PNG, JPG or WebP pictures work.',
    });
    expect(await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: '***' }, e)).toMatchObject({
      success: false,
    });
    expect(
      await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: 'A'.repeat(8_000_000) }, e)
    ).toMatchObject({ success: false, error: 'That picture is too big. The limit is 5 MB.' });
    expect(await uploadActorImage({}, e)).toMatchObject({ success: false });
    expect(uploads).toEqual([]);
  });

  it('is not a success when Foundry answers without a path or with another place', async () => {
    const { e } = env();
    const nopath: ActorImageEnv = {
      ...e,
      picker: () => ({
        createDirectory: () => Promise.resolve(),
        upload: () => Promise.resolve({}),
      }),
    };
    expect(
      await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: b64(PNG) }, nopath)
    ).toMatchObject({ success: false });
    const elsewhere: ActorImageEnv = {
      ...e,
      picker: () => ({
        createDirectory: () => Promise.resolve(),
        upload: () => Promise.resolve({ path: 'somewhere/else.png' }),
      }),
    };
    expect(
      await uploadActorImage({ actor: 'Ebbe Thistlebottom', data: b64(PNG) }, elsewhere)
    ).toMatchObject({ success: false });
  });
});
