// Story shots (UI-03): one screenshot of every story in the built Storybook (storybook-static/),
// in the story's own theme and screen size, and an axe check of the same stories. Runs in the
// `stories` project of playwright.visual.config.ts, which serves the folder (scripts/serve-static.mjs).
//
//   npm run build-storybook -w @gnuminator/cogm-dashboard     once, on the host
//   npm run test:visual -w @gnuminator/cogm-dashboard         then the checks, in Docker
//
// The stories are found in storybook-static/index.json, so a new story gets a baseline the next
// time `npm run test:visual:update` runs, with no list to edit. Baselines live in
// visual/__screenshots__/stories/<story id>.png (Linux only, like the app shots).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { KNOWN_STORY_VIOLATIONS } from './axe-known-stories';
import { contentClip, loadStories, showStory } from './stories';

const FAILING = new Set(['serious', 'critical']);
const stories = loadStories();

test('the stories are built', () => {
  expect(
    stories.length,
    'storybook-static/index.json has no stories. Run: npm run build-storybook -w @gnuminator/cogm-dashboard'
  ).toBeGreaterThan(0);
});

for (const story of stories) {
  test(`story: ${story.id}`, async ({ page }) => {
    await showStory(page, story);
    const clip = await contentClip(page);
    await expect(page).toHaveScreenshot(`${story.id}.png`, {
      fullPage: true,
      ...(clip ? { clip } : {}),
    });
  });

  test(`axe: ${story.id}`, async ({ page }) => {
    await showStory(page, story);
    // The preview iframe is the whole page, so axe sees the story and nothing of Storybook's UI.
    const { violations } = await new AxeBuilder({ page }).analyze();
    const found = violations
      .filter(v => v.impact && FAILING.has(v.impact))
      .flatMap(v =>
        v.nodes.map(n => ({
          rule: v.id,
          target: n.target.join(' '),
          selector: n.target.length === 1 && typeof n.target[0] === 'string' ? n.target[0] : null,
        }))
      );

    const applicable = KNOWN_STORY_VIOLATIONS.filter(k => k.stories.includes(story.id));
    const seen = new Set<(typeof applicable)[number]>();
    const fresh: typeof found = [];
    for (const f of found) {
      let known = false;
      for (const k of applicable) {
        if (k.rule !== f.rule || f.selector === null) continue;
        // The node is the entry's element or inside it (axe may name a child of it).
        const hit = await page.evaluate(
          ([axeSelector, knownSelector]) =>
            document.querySelector(axeSelector)?.closest(knownSelector) != null,
          [f.selector, k.target] as const
        );
        if (hit) {
          seen.add(k);
          known = true;
        }
      }
      if (!known) fresh.push(f);
    }
    expect(
      fresh,
      'serious or critical axe violations that are not in axe-known-stories.ts'
    ).toEqual([]);

    const stale = applicable.filter(k => !seen.has(k)).map(k => `${k.rule}: ${k.target}`);
    expect(stale, 'axe-known-stories.ts entries that no longer occur here: remove them').toEqual(
      []
    );
  });
}
