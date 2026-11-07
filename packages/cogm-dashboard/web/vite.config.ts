// The React dashboard (D-109): built into dist/web and served by the dashboard at /next/.
// The page links the shared stylesheets, themes, fonts and usage.js from public/ at run time
// (one copy of The Veil), so the build leaves
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
  '/styles.css',
  '/moments.css',
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
