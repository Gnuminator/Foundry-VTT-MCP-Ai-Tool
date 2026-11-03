// Svelte spike (never merged): builds one minimal Party shell on its own, so the shell and the
// lazy panel chunk can be measured apart (spike/measure.mjs).
//
//   SPIKE=svelte npx vite build -c web/spike/vite.spike.config.ts
//   SPIKE=react  npx vite build -c web/spike/vite.spike.config.ts
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

//   SPIKE=preact npx vite build -c web/spike/vite.spike.config.ts   the React shell on preact/compat
const which = process.env.SPIKE ?? 'svelte';
const preact = which === 'preact';
// The step 1 aliases, inline: the preact build is the React code with react resolved to Preact.
const alias = preact
  ? [
      { find: /^react$/, replacement: 'preact/compat' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/compat/jsx-runtime' },
    ]
  : [];

export default defineConfig({
  root: fileURLToPath(new URL(`./${preact ? 'react' : which}`, import.meta.url)),
  base: './',
  publicDir: false,
  plugins: [which === 'svelte' ? svelte() : react()],
  resolve: { alias },
  build: {
    outDir: fileURLToPath(new URL(`../../dist-spike/${which}`, import.meta.url)),
    emptyOutDir: true,
  },
});
