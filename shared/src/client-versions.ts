/**
 * Client version handshake (item `client-updates`, layer 2; design note vault
 * `Design/Client updates 2026-11-14.md`). The pieces that live on a GM's or player's own PC report
 * their version; the Pi compares it with the version it runs itself (never an online "latest"), and
 * an older piece gets one outdated line with a download place.
 *
 * - GM connectors (the installer's stdio wrappers) report through the control socket `hello`.
 * - The player extension (`foundry-player.mcpb`) reports through its user-agent
 *   `foundry-player-connector/<version>`.
 * - The Obsidian plugin reports through the {@link CLIENT_HEADER} header, `obsidian/<version>`.
 *
 * Names and version numbers only; nothing here carries campaign content or a secret.
 */

export type ClientPiece = 'connectors' | 'player-extension' | 'obsidian';

/** The header the Obsidian plugin (and any later client) sends: `<piece token>/<version>`. */
export const CLIENT_HEADER = 'x-foundry-client';

/** A random id per Obsidian install (12 hex), so the table can tell two PCs apart. Never a name. */
export const INSTALL_HEADER = 'x-foundry-install';

/** At most one outdated line per connection or player in a tool answer within this window. */
export const CLIENT_NOTICE_INTERVAL_MS = 6 * 3600 * 1000;

/** The public release page the download links point into. */
export const RELEASE_DOWNLOAD_BASE =
  'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/download';

const VERSION_RE = /^v?(\d{1,4}(?:\.\d{1,6}){0,3})(?:[-+][0-9A-Za-z.-]{0,40})?$/;

/** A plain `x.y.z` from a reported version, or null when it is not one. */
export function cleanClientVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = VERSION_RE.exec(raw.trim());
  return m ? m[1] : null;
}

/** Numeric per dot segment; -1 when a is older, 1 when newer, 0 when equal. */
export function compareClientVersions(a: string, b: string): number {
  const pa = a.split('.').map(p => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map(p => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * True when `version` is older than the Pi's `current`. A missing version is never "behind" here
 * (the player extension and the Obsidian plugin show "not reported"); a connector that never said
 * hello is old by definition and is judged by the backend's wrapper registry instead.
 */
export function isClientBehind(version: string | null, current: string): boolean {
  return version !== null && compareClientVersions(version, current) < 0;
}

/** The player extension's version from its user-agent; null for anything else. */
export function playerExtensionVersion(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string') return null;
  const m = /(?:^|\s)foundry-player-connector\/(\S{1,60})/.exec(userAgent);
  return m ? cleanClientVersion(m[1]) : null;
}

/** The {@link CLIENT_HEADER} value as piece and version; null when it is not one we know. */
export function parseClientHeader(value: unknown): { piece: 'obsidian'; version: string } | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*obsidian\/(\S{1,60})\s*$/i.exec(value);
  if (!m) return null;
  const version = cleanClientVersion(m[1]);
  return version ? { piece: 'obsidian', version } : null;
}

/** The release asset a piece is updated from, for the Pi's version. */
export function clientDownloadUrl(piece: ClientPiece, current: string): string | null {
  const tag = `v${current}`;
  if (piece === 'connectors') {
    return `${RELEASE_DOWNLOAD_BASE}/${tag}/FoundryMCPServer-Setup-${tag}.exe`;
  }
  if (piece === 'obsidian') return `${RELEASE_DOWNLOAD_BASE}/${tag}/foundry-ai-tool-obsidian.zip`;
  // The player extension is built per player by the Pi: "Download my helper" on My character.
  return null;
}

export interface ClientNotice {
  da: string;
  en: string;
}

/**
 * The banner text (Danish first, English below; the user 2026-11-14). `link` is the download url
 * for connectors and the Obsidian plugin; the player extension points at My character instead.
 */
export function clientNoticeText(
  piece: ClientPiece,
  old: string,
  current: string,
  link: string | null = clientDownloadUrl(piece, current)
): ClientNotice {
  if (piece === 'connectors') {
    return {
      da: `Opdatering klar: dine Claude Desktop-forbindelser er ${old}, bordet kører ${current}. Hent installationen her: ${link ?? ''}`.trim(),
      en: `Update available: your Claude Desktop connectors are ${old}, the table runs ${current}. Get the installer: ${link ?? ''}`.trim(),
    };
  }
  if (piece === 'obsidian') {
    return {
      da: `Opdatering klar: dit Obsidian-plugin er ${old}, bordet kører ${current}. Hent det her: ${link ?? ''}`.trim(),
      en: `Update available: your Obsidian plugin is ${old}, the table runs ${current}. Download: ${link ?? ''}`.trim(),
    };
  }
  return {
    da: `Opdatering klar: din spiller-udvidelse er ${old}, bordet kører ${current}. Tryk på "Download my helper" på siden My character og installer filen igen.`,
    en: `Update available: your player extension is ${old}, the table runs ${current}. Press Download my helper on My character and install the file again.`,
  };
}

/**
 * The one line added to a tool answer (English: Claude passes it on in the chat's language).
 * `old` null means a connector too old to report a version at all.
 */
export function clientToolNotice(piece: ClientPiece, old: string | null, current: string): string {
  const was = old ?? 'an older version';
  if (piece === 'connectors') {
    return `Update available: these Claude Desktop connectors are ${was}, the table runs ${current}. Run the installer again (it keeps the token): ${clientDownloadUrl('connectors', current)}`;
  }
  if (piece === 'player-extension') {
    return `Update available: this player extension is ${was}, the table runs ${current}. Press "Download my helper" on your My character page and install the file again.`;
  }
  return `Update available: the Obsidian plugin is ${was}, the table runs ${current}: ${clientDownloadUrl('obsidian', current)}`;
}

/** One piece seen by the dashboard, for `GET /api/client-versions`. */
export interface ClientSeen {
  piece: ClientPiece;
  /** The Foundry user name for a player extension; "GM" for the GM's own pieces. */
  who: string;
  /** null: the piece connected but is too old to say its version. */
  version: string | null;
  behind: boolean;
  /** ISO time it was last seen. */
  lastSeen: string;
}

/**
 * The revision of the thin skill stubs (tools/gm-coach/stub, tools/dnd-helper/stub and
 * stub-player). It is NOT the release version: a stub changes rarely, so it carries its own number
 * and bumps it only when the stub text changes (a test pins the stubs to this value). The stub
 * passes its number as `stubRevision` to the skill guide tools.
 */
export const SKILL_STUB_REVISION = 1;

export type SkillName = 'gm-coach' | 'dnd-helper' | 'dnd-helper-player';

/** True when a stub that reports `revision` is older than the served {@link SKILL_STUB_REVISION}. */
export function isSkillStubBehind(revision: unknown): boolean {
  return (
    typeof revision === 'number' && Number.isFinite(revision) && revision < SKILL_STUB_REVISION
  );
}

/**
 * The one line added to a skill guide answer when the uploaded stub is behind (English; Claude
 * passes it on in the chat's language). The zip is a file of the release the table runs.
 */
export function skillStubNotice(skill: SkillName, current: string): string {
  const file = `foundry-${skill === 'gm-coach' ? 'gm-coach' : skill === 'dnd-helper' ? 'dnd-helper' : 'dnd-helper-player'}.zip`;
  return `Update available: this skill is older than the table's, which runs ${current}. Update the plugin, or upload ${file} again (Settings, Plugins, Skills): ${RELEASE_DOWNLOAD_BASE}/v${current}/${file}`;
}

export interface ClientVersionsView {
  /** The version the Pi runs: what every piece is compared with. */
  current: string;
  downloads: { connectors: string | null; obsidian: string | null };
  /** Every piece seen (GM only route; a player's own notice comes through `/api/me`). */
  seen: ClientSeen[];
}
