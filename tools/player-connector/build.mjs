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
import { collectPlayerFiles } from '../dnd-helper/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Turn a skill page path (references/player/join.md) into its guide topic (join). */
const topicOf = name => path.basename(name, '.md');

/**
 * The helper guide the extension carries (server/guide.json): the player skill's ground rules as
 * the MCP server `instructions`, and each flow page as a topic of the `get-helper-guide` tool. Built
 * from tools/dnd-helper so there is one source. Holds no book text and no secret.
 * @returns {{ instructions: string, pages: Record<string, string> }}
 */
export function buildGuide() {
  const files = collectPlayerFiles();
  const skill = files
    .get('SKILL.md')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .trimStart();
  const cut = skill.indexOf('## Which page to open');
  if (cut < 0) throw new Error('guide: the player SKILL.md has no "Which page to open" section');
  const link = text =>
    text
      .replace(
        /`references\/(?:player\/)?([a-z-]+)\.md`/g,
        (_m, topic) => `the "${topic}" topic of get-helper-guide`
      )
      .replace(/ground rule (\d+) of the skill/g, 'ground rule $1 of this guide')
      // Relative links between the public guides mean nothing to the model: name the topic instead.
      .replace(/\[([^\]]+)\]\((join|make-a-character)\.md\)/g, '$1 (the "$2" topic)')
      .replace(/\[([^\]]+)\]\(README\.md\)/g, '$1');
  const from = 'These five tools are all of them. Do not look for others,';
  if (!skill.includes(from)) throw new Error('guide: the tools sentence in SKILL.md changed');
  const body = skill
    .slice(0, cut)
    .replace(
      from,
      'These five tools, plus `get-helper-guide` (this guide), are all of them. Do not look for others,'
    )
    .trimEnd();
  const topics = [...files.keys()].filter(n => n.startsWith('references/')).map(topicOf);
  const instructions =
    `${body}\n\n## The guide pages\n\n` +
    `Before you start a character build, a level-up, a sheet check or a rules answer, call the tool ` +
    `\`get-helper-guide\` with the topic and follow that page in order. Topics: ${topics.join(', ')}. ` +
    `"make-a-character" and "join" are the player's own click-through guides.`;
  const pages = { overview: instructions };
  for (const [name, text] of files) {
    if (name.startsWith('references/')) pages[topicOf(name)] = link(text);
  }
  return { instructions, pages };
}

/** The guide as a file entry of the archive. */
function guideEntry() {
  return Buffer.from(JSON.stringify(buildGuide()) + '\n', 'utf8');
}

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
  files.set('server/guide.json', guideEntry());
  return files;
}

/** A file-name and extension-name piece from a player's name: lowercase letters, digits, hyphens. */
export function presetSlug(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/^-+|-+$/g, '');
}

/**
 * The files of one player's own extension (the "Download my helper" file): the generic template
 * with that player's endpoint, Client ID and Client Secret written as literals in
 * `mcp_config.env`, `user_config` removed (Desktop shows no form), a display name
 * "Foundry (<player>)" and a name of its own so two players' files can sit side by side. The result
 * holds a secret: it goes only to that player, never to a log, the repo or a release.
 * @param {{ endpoint: string, clientId: string, clientSecret: string, playerName: string, userId?: string }} p
 */
export function collectPresetFiles(p) {
  const endpoint = String(p.endpoint ?? '').trim();
  const clientId = String(p.clientId ?? '').trim();
  const clientSecret = String(p.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new Error('a Client ID and a Client Secret are needed');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('the endpoint is not an address');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('the endpoint must be an https:// address');
  const manifest = JSON.parse(readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  const label = String(p.playerName ?? '')
    // eslint-disable-next-line no-control-regex -- deliberate: strip control characters from the player name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 40);
  // The extension name comes from the Foundry user id, not the display name: it stays the same when
  // the user is renamed (a reinstall replaces the old one) and two players never share it.
  const id = String(p.userId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  manifest.name = `foundry-player-${id || presetSlug(label) || 'player'}`;
  manifest.display_name = `Foundry (${label || 'player'})`;
  manifest.long_description =
    "Connects Claude Desktop to the table's read-only player endpoint over HTTPS, already set up for you. " +
    'Nothing to paste. Claude can read your own character and short book passages, and cannot change anything. ' +
    'This file holds your personal login: treat it like a password and do not share it.';
  manifest.server.mcp_config.env = {
    FOUNDRY_PLAYER_ENDPOINT: url.toString(),
    FOUNDRY_PLAYER_CLIENT_ID: clientId,
    FOUNDRY_PLAYER_CLIENT_SECRET: clientSecret,
  };
  delete manifest.user_config;
  const files = new Map();
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
  files.set('server/index.js', readFileSync(path.join(here, 'server', 'index.js')));
  files.set('server/guide.json', guideEntry());
  return files;
}

/** The player's own extension as zip bytes (see collectPresetFiles). */
export function buildPreset(p) {
  return zip([...collectPresetFiles(p)].map(([name, data]) => ({ name, data })));
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
