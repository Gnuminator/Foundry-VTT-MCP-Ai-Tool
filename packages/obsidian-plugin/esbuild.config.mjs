/**
 * Builds the Obsidian plugin into dist/ (main.js, manifest.json, styles.css): the three files
 * Obsidian loads from <vault>/.obsidian/plugins/foundry-ai-tool/. Obsidian supplies `obsidian`
 * and `electron` at runtime, so they stay external.
 *
 * styles.css is the plugin's own styles plus the theme (I-099, theme/obsidian-theme.css) with
 * the dashboard's fonts inlined; FONT-LICENSES.txt goes beside it. dist/snippets/ holds the
 * theme as one CSS snippet per theme, for vaults without the plugin (the player vault).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { THEMES, licenseText, pluginCss, snippetCss } from './theme/build-css.mjs';

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
copyFileSync(path.join(here, 'manifest.json'), path.join(out, 'manifest.json'));

const fontsDir = path.join(here, '..', 'cogm-dashboard', 'public', 'fonts');
const theme = readFileSync(path.join(here, 'theme', 'obsidian-theme.css'), 'utf8');
const base = readFileSync(path.join(here, 'styles.css'), 'utf8');
writeFileSync(path.join(out, 'styles.css'), pluginCss({ base, theme, fontsDir }));
writeFileSync(path.join(out, 'FONT-LICENSES.txt'), licenseText(fontsDir));
mkdirSync(path.join(out, 'snippets'), { recursive: true });
for (const id of THEMES) {
  writeFileSync(
    path.join(out, 'snippets', `aitool-theme-${id}.css`),
    snippetCss({ theme, id, fontsDir })
  );
}
