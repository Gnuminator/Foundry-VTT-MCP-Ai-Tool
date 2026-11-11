#!/usr/bin/env node
/**
 * Manual fallback for "Download my helper" on /me: write one player's own extension file
 * (tools/player-connector buildPreset, the same function the dashboard uses) from the connector
 * config file. Prints the path and the player's name, never the Client ID or the Secret.
 *
 *   npm run player-preset -- --player <name-or-user-id> [--config <file>] [--out <dir>]
 *
 *   --config  the connector file (default: FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG)
 *   --out     where the file goes (default: <home>/foundry-player-presets, outside the repo)
 *   --player  a Foundry user id, or the optional "name" of an entry in the config file
 *
 * The output holds a login. Send it only to that player, privately; never attach it to a release,
 * commit it or put it in the vault.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreset, presetSlug } from '../tools/player-connector/build.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Pick the player's entry; a name must match exactly one entry (case-insensitive). */
export function findPlayer(config, wanted) {
  const players = Array.isArray(config?.players) ? config.players : [];
  const w = String(wanted ?? '')
    .trim()
    .toLowerCase();
  if (!w) throw new Error('--player is required');
  const hits = players.filter(
    p =>
      String(p?.userId ?? '').toLowerCase() === w ||
      (typeof p?.name === 'string' && p.name.trim().toLowerCase() === w)
  );
  if (hits.length !== 1)
    throw new Error(
      hits.length === 0
        ? 'no such player in the config file (use a Foundry user id, or add a "name" to the entry)'
        : 'more than one entry matches that player'
    );
  return hits[0];
}

export function run(argv = {}) {
  const configFile = argv.config ?? process.env.FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG;
  if (!configFile) throw new Error('--config or FOUNDRY_AI_PLAYER_CONNECTOR_CONFIG is needed');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const entry = findPlayer(config, argv.player);
  const playerName = String(entry.name ?? argv.player);
  const bytes = buildPreset({
    endpoint: config.endpoint,
    clientId: entry.clientId,
    clientSecret: entry.clientSecret,
    playerName,
    userId: entry.userId,
  });
  const outDir = path.resolve(argv.out ?? path.join(os.homedir(), 'foundry-player-presets'));
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `foundry-player-${presetSlug(playerName) || 'player'}.mcpb`);
  writeFileSync(file, bytes);
  return { file, playerName };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { file, playerName } = run({
      player: arg('player'),
      config: arg('config'),
      out: arg('out'),
    });
    console.log(`player-preset: wrote ${file} for ${playerName}. It holds that player's login.`);
  } catch (error) {
    // Only our own fixed messages: a JSON parse error could quote the file.
    const own = error instanceof Error && !(error instanceof SyntaxError);
    console.error(`player-preset: ${own ? error.message : 'could not read the config file'}`);
    process.exit(1);
  }
}
