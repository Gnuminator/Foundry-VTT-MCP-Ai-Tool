// The stories the story shots photograph: read from the built Storybook (storybook-static/
// index.json), so a new story is photographed without a line here. Shared by the screenshot
// test and the axe check, so both look at the same stories in the same state.
//
// A story picks its own theme and screen size with tags (web/src/storybook/modes.ts): `veil` for
// The Veil, `phone` for 390 px wide. Everything else shows in the neutral theme on a 1100 px frame.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

import { NOW } from './fixtures';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const STORYBOOK_DIR = path.join(packageDir, 'storybook-static');
export const STORYBOOK_PORT = 6199;

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  tags: string[];
}

/** The stories of the built Storybook (docs pages left out); empty when it is not built yet. */
export function loadStories(): StoryEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path.join(STORYBOOK_DIR, 'index.json'), 'utf8');
  } catch {
    return [];
  }
  const { entries } = JSON.parse(raw) as {
    entries: Record<string, StoryEntry & { type: string }>;
  };
  return Object.values(entries).filter(e => e.type === 'story');
}

export const DESKTOP = { width: 1100, height: 760 } as const;
/** The same size as PHONE in web/src/storybook/modes.ts. */
export const PHONE = { width: 390, height: 844 } as const;

export const themeOf = (story: StoryEntry): 'neutral' | 'veil' =>
  story.tags.includes('veil') ? 'veil' : 'neutral';

/**
 * Opens the story on its own page (iframe.html, the preview without Storybook's chrome), waits
 * until it has rendered and its play step has run, and settles the page the way the app shots do:
 * fonts loaded, the clock fixed, the mouse out of the way, nothing in flight.
 */
export async function showStory(page: Page, story: StoryEntry): Promise<void> {
  await page.setViewportSize(story.tags.includes('phone') ? PHONE : DESKTOP);
  await page.clock.setFixedTime(NOW);
  const globals = themeOf(story) === 'veil' ? '&globals=theme:veil' : '';
  await page.goto(`/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story${globals}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeOf(story));
  // StoryRender's last phase: "finished" once the story rendered and its play step ran.
  await page.waitForFunction(() => {
    const phase = (
      window as unknown as {
        __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } };
      }
    ).__STORYBOOK_PREVIEW__?.currentRender?.phase;
    return phase === 'finished' || phase === 'errored' || phase === 'aborted';
  });
  const error = await page
    .locator('.sb-errordisplay:visible')
    .first()
    .textContent({ timeout: 100 })
    .catch(() => null);
  expect(error, `story ${story.id} did not render`).toBeNull();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(0, 0);
}

/**
 * The part of the page worth photographing: the story's own content and the Radix layers that
 * open over it (drawers, menus, the confirm window, toasts), with a margin. The rest of the frame
 * is empty page, which would only add bytes. Undefined when nothing measurable is on the page.
 */
export async function contentClip(
  page: Page
): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  return page.evaluate(() => {
    const margin = 16;
    const rects: DOMRect[] = [];
    const add = (el: Element): void => {
      const r = el.getBoundingClientRect();
      if (r.width >= 20 && r.height >= 20) rects.push(r);
    };
    document.querySelectorAll('#storybook-root > *').forEach(add);
    for (const el of Array.from(document.body.children)) {
      if (el.id === 'storybook-root' || el.id === 'storybook-docs') continue;
      if (/^(SCRIPT|STYLE|LINK)$/.test(el.tagName) || el.className.toString().startsWith('sb-')) {
        continue;
      }
      add(el);
    }
    if (rects.length === 0) return undefined;
    const left = Math.min(...rects.map(r => r.left)) - margin;
    const top = Math.min(...rects.map(r => r.top)) - margin;
    const right = Math.max(...rects.map(r => r.right)) + margin;
    const bottom = Math.max(...rects.map(r => r.bottom)) + margin;
    const x = Math.max(0, Math.floor(left));
    const y = Math.max(0, Math.floor(top));
    const width = Math.min(Math.ceil(right) - x, document.documentElement.scrollWidth - x);
    // A very tall story (a long list) is cut: the first screens say what the story is.
    const height = Math.min(Math.ceil(bottom) - y, 2000, document.documentElement.scrollHeight - y);
    return { x, y, width: Math.max(width, 1), height: Math.max(height, 1) };
  });
}
