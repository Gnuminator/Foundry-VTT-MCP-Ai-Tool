// Svelte spike (never merged): gzip sizes of the two Party shells, measured the way the bundle
// budget measures the dashboard (zlib level 9, first load = entry plus modulepreloads).
//
//   node web/spike/measure.mjs        after both spike builds (vite.spike.config.ts)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { firstLoadFiles } from '../../scripts/bundle-budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-spike');
const kb = n => (n / 1000).toFixed(1);

for (const which of ['svelte', 'react', 'preact']) {
  const dir = path.join(root, which);
  const assets = path.join(dir, 'assets');
  const first = firstLoadFiles(
    readFileSync(path.join(dir, 'index.html'), 'utf8').replaceAll('./assets/', '/assets/')
  );
  const size = f => {
    const b = readFileSync(path.join(assets, f));
    return { f, raw: b.length, gzip: gzipSync(b, { level: 9 }).length };
  };
  const shell = first.map(size);
  const lazy = readdirSync(assets)
    .filter(f => f.endsWith('.js') && !first.includes(f))
    .map(size);
  const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  console.log(`${which}: shell ${kb(sum(shell, 'gzip'))} KB gzip (${kb(sum(shell, 'raw'))} raw)`);
  for (const l of lazy) console.log(`  lazy ${l.f}: ${kb(l.gzip)} KB gzip (${kb(l.raw)} raw)`);
  console.log(`  shell + panel: ${kb(sum(shell, 'gzip') + sum(lazy, 'gzip'))} KB gzip`);
}
