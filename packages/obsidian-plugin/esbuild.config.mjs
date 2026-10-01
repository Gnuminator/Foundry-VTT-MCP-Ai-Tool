/**
 * Builds the Obsidian plugin into dist/ (main.js, manifest.json, styles.css): the three files
 * Obsidian loads from <vault>/.obsidian/plugins/foundry-ai-tool/. Obsidian supplies `obsidian`
 * and `electron` at runtime, so they stay external.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');

mkdirSync(out, { recursive: true });
await build({
  entryPoints: [path.join(here, 'src', 'main.ts')],
  outfile: path.join(out, 'main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*'],
  logLevel: 'warning',
  legalComments: 'none',
});
for (const file of ['manifest.json', 'styles.css']) {
  copyFileSync(path.join(here, file), path.join(out, file));
}
