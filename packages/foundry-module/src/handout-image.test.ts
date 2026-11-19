import { describe, expect, it } from 'vitest';

import type { PortraitPicker } from './player-portrait.js';
import { handoutFileName, uploadHandoutImage, type HandoutImageEnv } from './handout-image.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function env(
  over: Partial<HandoutImageEnv> = {},
  log: { folders: string[]; uploads: Array<{ path: string; name: string }> } = {
    folders: [],
    uploads: [],
  }
): HandoutImageEnv {
  return {
    enabled: (): boolean => true,
    picker: (): PortraitPicker => ({
      createDirectory: (_s: string, p: string): Promise<unknown> => {
        log.folders.push(p);
        return Promise.resolve();
      },
      upload: (_s: string, p: string, file: File): Promise<unknown> => {
        log.uploads.push({ path: p, name: file.name });
        return Promise.resolve({ path: `worlds/w/${p}/${file.name}` });
      },
    }),
    now: (): Date => new Date('2026-11-19T20:00:00Z'),
    random: (): string => 'abcd1234',
    ...over,
  };
}

describe('uploadHandoutImage', () => {
  it('stores a PNG in assets/ai-art/handouts under a name it makes', async () => {
    const log = { folders: [] as string[], uploads: [] as Array<{ path: string; name: string }> };
    const reply = await uploadHandoutImage({ data: b64(PNG_BYTES) }, env({}, log));
    expect(reply).toEqual({
      success: true,
      path: 'assets/ai-art/handouts/handout-20261119200000-abcd1234.png',
    });
    expect(log.folders).toEqual(['assets', 'assets/ai-art', 'assets/ai-art/handouts']);
    expect(handoutFileName(new Date('2026-11-19T20:00:00Z'), 'abcd1234')).toBe(
      'handout-20261119200000-abcd1234.png'
    );
  });

  it('refuses while the handouts switch is off', async () => {
    const reply = await uploadHandoutImage({ data: b64(PNG_BYTES) }, env({ enabled: () => false }));
    expect(reply.success).toBe(false);
  });

  it('refuses missing data, bad base64 and non-PNG bytes', async () => {
    expect((await uploadHandoutImage({}, env())).success).toBe(false);
    expect((await uploadHandoutImage({ data: '!!' }, env())).success).toBe(false);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await uploadHandoutImage({ data: b64(jpg) }, env())).error).toMatch(/PNG/);
  });

  it('refuses a file Foundry stored somewhere unexpected', async () => {
    const reply = await uploadHandoutImage(
      { data: b64(PNG_BYTES) },
      env({
        picker: (): PortraitPicker => ({
          createDirectory: (): Promise<unknown> => Promise.resolve(),
          upload: (): Promise<unknown> => Promise.resolve({ path: 'elsewhere/x.png' }),
        }),
      })
    );
    expect(reply.success).toBe(false);
  });
});
