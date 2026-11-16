// The React dashboard (D-109): built into dist/web and served by the dashboard at / (the page), with its files under /next/ (Vite's base).
// The page bundles the old stylesheets and themes (src/styles/index.css); fonts, usage.js and favicons come from public/ at run time
// (the themes are one file, also linked by the player pages), so the build leaves
// those URLs alone.
//
//   npm run build -w @gnuminator/cogm-dashboard     tsc, the help pages, then this build
//   npm run dev:web -w @gnuminator/cogm-dashboard   Vite on 5173, /api and the public/ assets
//                                                   proxied to a dashboard on COGM_DEV_TARGET
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const appVersion = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;
const target = process.env.COGM_DEV_TARGET ?? 'http://127.0.0.1:3100';
// Served by the dashboard from public/; the React page reuses them as they are.
const SERVER_PATHS = [
  '/api',
  '/themes',
  '/fonts',
  '/usage.js',
  '/favicon-16.png',
  '/favicon-32.png',
];

export default defineConfig({
  root: webDir,
  base: '/next/',
  // public/ holds the shared assets and the server serves it; nothing to copy.
  publicDir: false,
  plugins: [react()],
  // The tool version for the header (lib/appVersion.ts).
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    // One stylesheet in import order: main.tsx imports styles/index.css first, so the old rules
    // stay ahead of every CSS Module as before (split CSS puts a shared chunk's modules first).
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // The old stylesheets share a chunk with the ui/ CSS Modules, where main.tsx's import
        // order (styles first) decides: a shared chunk's CSS otherwise goes ahead of the entry's.
        manualChunks: id =>
          id.includes('/web/src/styles/') || id.includes('/web/src/ui/') ? 'ui' : undefined,
      },
    },
    // Kept on purpose: the repo is public, and readable stack traces in a GM's browser are worth
    // the few hundred KB on Docker and the Pi.
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(SERVER_PATHS.map(p => [p, { target, changeOrigin: false }])),
  },
});
