// A page shot: the screenshot of a whole dashboard or player page. It is rendered on every run and
// written to page-shots/<project>/<name> (CI uploads that folder as the artifact
// dashboard-page-shots-<shard>), but it is NOT compared with a committed PNG: a control added to a
// page would otherwise change committed baselines in nearly every dashboard PR. The story shots
// (stories.spec.ts) stay compared; they are the pixel guard.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page, TestInfo } from '@playwright/test';

/** Where the page shots land, next to web/ so Playwright's own output folder cleaning leaves them. */
export const PAGE_SHOTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'page-shots'
);

export async function pageShot(
  page: Page,
  info: TestInfo,
  name: string,
  options: { fullPage: boolean; mask?: ReturnType<Page['locator']>[] }
): Promise<void> {
  await page.screenshot({
    path: path.join(PAGE_SHOTS_DIR, info.project.name, name),
    animations: 'disabled',
    caret: 'hide',
    ...options,
  });
}
