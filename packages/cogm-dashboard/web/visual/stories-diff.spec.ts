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
      const delta = (p: ImageData, q: ImageData, i: number, j: number, yOnly = false): number => {
        const a1 = p.data[i + 3] / 255;
        const a2 = q.data[j + 3] / 255;
        const r1 = blend(p.data[i], a1);
        const g1 = blend(p.data[i + 1], a1);
        const b1 = blend(p.data[i + 2], a1);
        const r2 = blend(q.data[j], a2);
        const g2 = blend(q.data[j + 1], a2);
        const b2 = blend(q.data[j + 2], a2);
        const dy = 0.29889531 * (r1 - r2) + 0.58662247 * (g1 - g2) + 0.11448223 * (b1 - b2);
        if (yOnly) return dy;
        const di = 0.59597799 * (r1 - r2) - 0.2741761 * (g1 - g2) - 0.32180189 * (b1 - b2);
        const dq = 0.21147017 * (r1 - r2) - 0.52261711 * (g1 - g2) + 0.31114694 * (b1 - b2);
        return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
      };
      const w = y.width;
      const h = y.height;
      // pixelmatch's anti-aliasing test: a differing pixel on a soft edge (rounded corner, text) is
      // not a change, as in the default pixelmatch run.
      const sameRgba = (p: ImageData, i: number, j: number): boolean =>
        p.data[i] === p.data[j] &&
        p.data[i + 1] === p.data[j + 1] &&
        p.data[i + 2] === p.data[j + 2] &&
        p.data[i + 3] === p.data[j + 3];
      const manySiblings = (p: ImageData, x1: number, y1: number): boolean => {
        const x0 = Math.max(x1 - 1, 0);
        const y0 = Math.max(y1 - 1, 0);
        const x2 = Math.min(x1 + 1, w - 1);
        const y2 = Math.min(y1 + 1, h - 1);
        const pos = (y1 * w + x1) * 4;
        let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
        for (let xx = x0; xx <= x2; xx++) {
          for (let yy = y0; yy <= y2; yy++) {
            if (xx === x1 && yy === y1) continue;
            if (sameRgba(p, pos, (yy * w + xx) * 4)) zeroes++;
            if (zeroes > 2) return true;
          }
        }
        return false;
      };
      const antialiased = (p: ImageData, q: ImageData, x1: number, y1: number): boolean => {
        const x0 = Math.max(x1 - 1, 0);
        const y0 = Math.max(y1 - 1, 0);
        const x2 = Math.min(x1 + 1, w - 1);
        const y2 = Math.min(y1 + 1, h - 1);
        const pos = (y1 * w + x1) * 4;
        let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
        let min = 0;
        let max = 0;
        let minX = 0;
        let minY = 0;
        let maxX = 0;
        let maxY = 0;
        for (let xx = x0; xx <= x2; xx++) {
          for (let yy = y0; yy <= y2; yy++) {
            if (xx === x1 && yy === y1) continue;
            const d = delta(p, p, pos, (yy * w + xx) * 4, true);
            if (d === 0) {
              zeroes++;
              if (zeroes > 2) return false;
            } else if (d < min) {
              min = d;
              minX = xx;
              minY = yy;
            } else if (d > max) {
              max = d;
              maxX = xx;
              maxY = yy;
            }
          }
        }
        if (min === 0 || max === 0) return false;
        return (
          (manySiblings(p, minX, minY) && manySiblings(q, minX, minY)) ||
          (manySiblings(p, maxX, maxY) && manySiblings(q, maxX, maxY))
        );
      };
      const canvas = document.createElement('canvas');
      canvas.width = y.width;
      canvas.height = y.height;
      const ctx = canvas.getContext('2d')!;
      const diff = ctx.createImageData(y.width, y.height);
      let pixels = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        if (
          delta(x, y, i, i) > maxDelta &&
          !antialiased(x, y, px, py) &&
          !antialiased(y, x, px, py)
        ) {
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

// With no base stories every story would show as added: render nothing and let the test above say why.
for (const id of baseStories.size === 0 ? [] : ids) {
  test(`diff: ${id}`, async ({ page }) => {
    const baseStory = baseStories.get(id);
    const headStory = headStories.get(id);
    test.setTimeout(90_000);
    const entry: Record<string, unknown> = { id, status: 'same', pixels: 0 };
    mkdirSync(path.join(out, 'entries'), { recursive: true });
    // Provisional entry, overwritten at the end: a timeout still leaves a trace in the report.
    writeFileSync(
      path.join(out, 'entries', `${id}.json`),
      JSON.stringify({ id, status: 'error', error: 'timed out or crashed' })
    );
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
