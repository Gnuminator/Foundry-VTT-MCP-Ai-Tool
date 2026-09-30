/**
 * Pre-flight contract (ideas I-068, I-067, I-076; batch 1 lane A): the checks
 * the GM runs before a session, and the read-only scan behind them.
 *
 * Flow:
 * - The module's `getPreflightScan` query runs on the GM client, where every
 *   world setting and document is readable. It matches world-scope settings
 *   against secret patterns and returns only MASKED values, lists the names
 *   players can see (playlists, sounds, scenes, tokens, journals, actors), and
 *   checks active modules against a conflict list.
 * - The bridge tool `get-preflight` runs the secret terms over those names,
 *   adds the bridge-side checks (Foundry link, module and bridge versions,
 *   switches, play session, Obsidian folder) and returns one checklist.
 * - The dashboard adds its own checks (GM Actions, `/player` free of secret
 *   terms) and the manual items from `docs/gm/before-session.md`.
 *
 * A scan result never carries a secret in full: `masked` keeps at most the
 * first four characters and the length.
 */

/** Module query name (prefixed with the module id on the wire). GM client only. */
export const PREFLIGHT_QUERY = 'getPreflightScan';

export type PreflightSeverity = 'fail' | 'warn' | 'info';

/** A world-scope setting that looks like a secret every client can read. */
export interface PreflightSettingFinding {
  /** `namespace.key`, as stored in the world's settings. */
  setting: string;
  /** The namespace (usually a module id). */
  namespace: string;
  /** Rule id, e.g. `discord-webhook`, `known:ddb-importer.cobalt-cookie`, `key-name`. */
  rule: string;
  severity: PreflightSeverity;
  /** One sentence for the GM: what leaks and what to do. */
  reason: string;
  /** At most four leading characters plus the length, never the value. */
  masked: string;
}

export const PLAYER_VISIBLE_NAME_KINDS = [
  'playlist',
  'sound',
  'scene',
  'token',
  'journal',
  'page',
  'actor',
] as const;

export type PlayerVisibleNameKind = (typeof PLAYER_VISIBLE_NAME_KINDS)[number];

/** A name at least one player can see in Foundry right now. */
export interface PlayerVisibleName {
  kind: PlayerVisibleNameKind;
  /** Document id (for a sound or page: the parent id, a dot, the id). */
  id: string;
  name: string;
}

/** An active module (or a missing recommended one) worth a look before play. */
export interface PreflightModuleFinding {
  moduleId: string;
  title: string;
  rule: string;
  severity: PreflightSeverity;
  reason: string;
}

/** What `getPreflightScan` returns. */
export interface PreflightScan {
  schema: 1;
  /** When the GM client computed it (ms since epoch). */
  computedAt: number;
  /** How many world-scope settings were checked. */
  settingsChecked: number;
  settings: PreflightSettingFinding[];
  names: PlayerVisibleName[];
  modules: PreflightModuleFinding[];
}

/** A player-visible name that matches a secret term. */
export interface PreflightNameFinding extends PlayerVisibleName {
  terms: string[];
}

export type PreflightCheckStatus = 'ok' | 'warn' | 'fail' | 'info' | 'unknown';

export const PREFLIGHT_CHECK_IDS = [
  'foundry-link',
  'versions',
  'write-switches',
  'world-settings',
  'visible-names',
  'modules',
  'obsidian',
  'play-session',
] as const;

export type PreflightCheckId = (typeof PREFLIGHT_CHECK_IDS)[number];

/** One line of the pre-flight checklist. */
export interface PreflightCheck {
  id: PreflightCheckId;
  label: string;
  status: PreflightCheckStatus;
  /** One or two sentences: what was found and, when not ok, what to do. */
  detail: string;
}

/** `get-preflight` with `action: "scan"`. */
export interface PreflightScanResult {
  computedAt: number;
  settingsChecked: number;
  settings: PreflightSettingFinding[];
  namesChecked: number;
  names: PreflightNameFinding[];
  modules: PreflightModuleFinding[];
}

/** `get-preflight` with `action: "checks"` (the default). */
export interface PreflightChecksResult {
  /** No check failed (warnings allowed). */
  ready: boolean;
  checks: PreflightCheck[];
  /** The scan behind the world-settings, visible-names and modules checks; null if it failed. */
  scan: PreflightScanResult | null;
  bridgeVersion: string;
  moduleVersion: string | null;
}
