// Everything a take may use, in one object. demo.mjs hands it to every take as `t.lib`, so
// a take kept outside the repo (a private video with licensed content) needs no imports
// from this folder: `const { humanClick, runPreflight } = t.lib;`.

export * from './browser.mjs';
export * from './dashboard.mjs';
export { DEMO_USERS, demoWorld } from './env.mjs';
export * from './foundry.mjs';
