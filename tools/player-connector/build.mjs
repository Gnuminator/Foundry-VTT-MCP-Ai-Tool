#!/usr/bin/env node
/**
 * Build the player connector Desktop extension: dist/foundry-player.mcpb (a zip of manifest.json
 * and server/index.js, the MCPB format Claude Desktop installs by double-click). Holds no secret
 * and no book text, so it can be attached to a public release.
 *
 *   node tools/player-connector/build.mjs                build into tools/player-connector/dist/
 *   node tools/player-connector/build.mjs --out <dir>    build somewhere else (tests)
 *
 * Optional: FOUNDRY_PLAYER_ENDPOINT=https://... in the environment fills the "Endpoint address"
 * field's default, so players paste only their two values. The address is not a secret (Access
 * guards it), but it stays out of the repo, so it is set at build time.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../gm-coach/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Entries of the archive: published path -> Buffer. */
export function collectFiles(endpoint = process.env.FOUNDRY_PLAYER_ENDPOINT) {
  const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  if (endpoint) {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:')
      throw new Error('FOUNDRY_PLAYER_ENDPOINT must be an https:// address');
    manifest.user_config.endpoint_url.default = u.toString();
  }
  const files = new Map();
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
  files.set('server/index.js', readFileSync(path.join(here, 'server', 'index.js')));
  return files;
}

/** Build the .mcpb into `outDir`; returns its path. */
export function build(outDir, endpoint) {
  const files = collectFiles(endpoint);
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'foundry-player.mcpb');
  writeFileSync(file, zip([...files].map(([name, data]) => ({ name, data }))));
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, 'dist');
  const file = build(outDir);
  console.log(`player-connector: wrote ${path.relative(process.cwd(), file)}`);
}
