// Two-sided story shots: every photographed story is rendered from the BASE Storybook (main, built
// in a second folder) and from the HEAD Storybook (this checkout) in the same container, and the
// two are compared. Nothing is committed; a difference is data, not a failure. Each story writes
//   <out>/entries/<id>.json                   what happened (same, changed, added, removed, error)
//   <out>/before|after|diff/<id>.png          only for stories that are not the same
// and scripts/visual-diff-report.mjs merges the shards into visual-diff.json and a diff page.
//
// Runs only when VISUAL_BASE_DIR is set (playwright.visual.config.ts adds the project then):
//   VISUAL_BASE_DIR=<base>/storybook-static VISUAL_DIFF_OUT=visual-diff VISUAL_SHARD=1/4 \
//     npx playwright test -c web/playwright.visual.config.ts --project stories-diff
// VISUAL_SHARD splits the sorted union of story ids, so a story only on one side still lands in one
// shard. Same pixel rule as the committed shots: a pixel counts when its colour differs by more than
// threshold 0.02 (pixelmatch's YIQ distance), and any such pixel makes the story "changed".
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  BASE_STORYBOOK_PORT,
  contentClip,
  loadStories,
  photographed,
  showStory,
  STORYBOOK_PORT,
} from './stories';

const THRESHOLD = 0.02;

const baseDir = process.env['VISUAL_BASE_DIR'] ?? '';
const out = path.resolve(process.env['VISUAL_DIFF_OUT'] ?? 'visual-diff');
const [shardIndex = 1, shardCount = 1] = (process.env['VISUAL_SHARD'] ?? '1/1')
  .split('/')
  .map(Number);

const headStories = new Map(
  loadStories()
    .filter(photographed)
    .map(s => [s.id, s])
);
const baseStories = new Map(
  loadStories(baseDir)
    .filter(photographed)
    .map(s => [s.id, s])
);
const ids = [...new Set([...headStories.keys(), ...baseStories.keys()])]
  .sort()
  .filter((_, i) => i % shardCount === shardIndex - 1);

const shoot = async (
  page: Page,
  story: NonNullable<ReturnType<typeof headStories.get>>,
  port: number
): Promise<Buffer> => {
  await showStory(page, story, `http://127.0.0.1:${port}`);
  const clip = await contentClip(page);
  return page.screenshot({
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    ...(clip ? { clip } : {}),
  });
};

interface Compared {
  pixels: number;
  width: number;
  height: number;
  sizeDiffers: boolean;
  diff: string | null;
}

// Decodes both PNGs in the browser (exact) and counts the differing pixels there, so no image
// library is needed in the repo.
const compare = (page: Page, before: Buffer, after: Buffer): Promise<Compared> =>
  page.evaluate(
    async ([a, b, threshold]) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const x = await decode(a);
      const y = await decode(b);
      if (x.width !== y.width || x.height !== y.height) {
        return {
          pixels: -1,
          width: y.width,
          height: y.height,
          sizeDiffers: true,
          diff: null,
        };
      }
      // pixelmatch's colour distance: YIQ delta, blended onto white by alpha.
      const maxDelta = 35215 * (threshold as number) ** 2;
      const blend = (c: number, alpha: number): number => 255 + (c - 255) * alpha;
      const delta = (i: number): number => {
        const a1 = x.data[i + 3] / 255;
        const a2 = y.data[i + 3] / 255;
        const r1 = blend(x.data[i], a1);
        const g1 = blend(x.data[i + 1], a1);
        const b1 = blend(x.data[i + 2], a1);
        const r2 = blend(y.data[i], a2);
        const g2 = blend(y.data[i + 1], a2);
        const b2 = blend(y.data[i + 2], a2);
        const dy = 0.29889531 * (r1 - r2) + 0.58662247 * (g1 - g2) + 0.11448223 * (b1 - b2);
        const di = 0.59597799 * (r1 - r2) - 0.2741761 * (g1 - g2) - 0.32180189 * (b1 - b2);
        const dq = 0.21147017 * (r1 - r2) - 0.52261711 * (g1 - g2) + 0.31114694 * (b1 - b2);
        return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
      };
      const canvas = document.createElement('canvas');
      canvas.width = y.width;
      canvas.height = y.height;
      const ctx = canvas.getContext('2d')!;
      const diff = ctx.createImageData(y.width, y.height);
      let pixels = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if (delta(i) > maxDelta) {
          pixels++;
          diff.data.set([255, 0, 0, 255], i);
        } else {
          // Unchanged pixels stay as a faded copy of the after image.
          const grey = 255 - (255 - (y.data[i] + y.data[i + 1] + y.data[i + 2]) / 3) * 0.25;
          diff.data.set([grey, grey, grey, 255], i);
        }
      }
      if (pixels === 0)
        return { pixels, width: y.width, height: y.height, sizeDiffers: false, diff: null };
      ctx.putImageData(diff, 0, 0);
      return {
        pixels,
        width: y.width,
        height: y.height,
        sizeDiffers: false,
        diff: canvas.toDataURL('image/png').split(',')[1],
      };
    },
    [before.toString('base64'), after.toString('base64'), THRESHOLD] as const
  );

const write = (kind: 'before' | 'after' | 'diff', id: string, data: Buffer): void => {
  mkdirSync(path.join(out, kind), { recursive: true });
  writeFileSync(path.join(out, kind, `${id}.png`), data);
};

test('the base and the head Storybook are built', () => {
  expect(baseStories.size, `no stories in VISUAL_BASE_DIR ${baseDir}`).toBeGreaterThan(0);
  expect(headStories.size, 'no stories in the head storybook-static').toBeGreaterThan(0);
});

for (const id of ids) {
  test(`diff: ${id}`, async ({ page }) => {
    const baseStory = baseStories.get(id);
    const headStory = headStories.get(id);
    const entry: Record<string, unknown> = { id, status: 'same', pixels: 0 };
    mkdirSync(path.join(out, 'entries'), { recursive: true });
    try {
      let before: Buffer | null = null;
      let after: Buffer | null = null;
      const errors: string[] = [];
      if (baseStory) {
        try {
          before = await shoot(page, baseStory, BASE_STORYBOOK_PORT);
        } catch (e) {
          errors.push(`base: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (headStory) {
        try {
          after = await shoot(page, headStory, STORYBOOK_PORT);
        } catch (e) {
          errors.push(`head: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      if (errors.length > 0) {
        entry['status'] = 'error';
        entry['error'] = errors.join('; ');
      } else if (!baseStory) {
        entry['status'] = 'added';
        write('after', id, after!);
      } else if (!headStory) {
        entry['status'] = 'removed';
        write('before', id, before!);
      } else {
        await page.goto('about:blank');
        const r = await compare(page, before!, after!);
        entry['pixels'] = r.pixels;
        entry['sizeDiffers'] = r.sizeDiffers;
        if (r.sizeDiffers || r.pixels > 0) {
          entry['status'] = 'changed';
          write('before', id, before!);
          write('after', id, after!);
          if (r.diff) write('diff', id, Buffer.from(r.diff, 'base64'));
        }
      }
    } catch (e) {
      entry['status'] = 'error';
      entry['error'] = (e as Error).message.split('\n')[0];
    }
    writeFileSync(path.join(out, 'entries', `${id}.json`), JSON.stringify(entry));
  });
}
