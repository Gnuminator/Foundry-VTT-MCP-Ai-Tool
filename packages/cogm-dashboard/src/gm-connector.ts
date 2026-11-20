import { readFileSync } from 'fs';

import { parseTeamDomain } from './access-jwt.js';

/**
 * The remote GM connector's login table (item remote-gm-connector). The five paths
 * `/mcp/core`, `/mcp/play`, `/mcp/prep`, `/mcp/build` and `/mcp/admin` sit behind the Cloudflare
 * Access application "Dashboard GMs remote" (Managed OAuth). The Pi keeps one small file
 * (`FOUNDRY_AI_GM_CONNECTOR_CONFIG`, never in the repo or the vault):
 *
 * ```json
 * { "appAudience": "<AUD tag of the GM remote Access application>",
 *   "gmEmails": ["gm@example.com"] }
 * ```
 *
 * `appAudience` is the check that Access signed the token for that application. `gmEmails` is
 * the app-side list of who is a GM here: only those verified emails get in. Absent, the
 * dashboard's own `GM_EMAILS` is used (the same meaning of "GM" as everywhere else); with neither,
 * or with a `gmEmails` key that names nobody usable, every login is refused.
 */

export interface GmConnectorFile {
  readonly appAudiences: readonly string[];
  readonly gmEmails: readonly string[];
  /** `gmEmails` is in the file but names nobody usable: every login is refused. */
  readonly gmEmailsBroken: boolean;
}

const EMPTY: GmConnectorFile = { appAudiences: [], gmEmails: [], gmEmailsBroken: false };

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseGmConnectorFile(raw: unknown): GmConnectorFile {
  const rec = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const aud = rec.appAudience;
  const appAudiences = (Array.isArray(aud) ? aud : [aud]).map(str).filter(a => a !== '');
  const mails = Array.isArray(rec.gmEmails) ? (rec.gmEmails as unknown[]) : [];
  const gmEmails = mails
    .map(m => str(m).toLowerCase())
    .filter(m => m.includes('@'))
    // A bad entry must not widen the list by silently emptying it: keep what parses.
    .filter((m, i, all) => all.indexOf(m) === i);
  // A key that is there but gives nobody (a string, no valid address) is a typo: refuse all,
  // never fall back to "anyone the Access policy admits".
  const gmEmailsBroken = 'gmEmails' in rec && gmEmails.length === 0;
  return { appAudiences, gmEmails, gmEmailsBroken };
}

export interface GmConnectorOptions {
  readonly enabled: boolean;
  /** `CF_ACCESS_TEAM_DOMAIN` parsed; '' when unset or malformed. */
  readonly teamDomain: string;
  /** Local development only: a bare loopback request counts as this email (never on a real setup). */
  readonly devEmail: string;
  readonly read: () => GmConnectorFile;
}

/** The options from the environment (`FOUNDRY_AI_GM_CONNECTOR*`, `CF_ACCESS_TEAM_DOMAIN`). */
export function gmConnectorFromEnv(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = (): void => undefined
): GmConnectorOptions {
  const enabled = (env.FOUNDRY_AI_GM_CONNECTOR ?? '').trim().toLowerCase() === 'on';
  const file = (env.FOUNDRY_AI_GM_CONNECTOR_CONFIG ?? '').trim();
  let warned = false;
  return {
    enabled,
    teamDomain: parseTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? ''),
    devEmail: (env.FOUNDRY_AI_GM_CONNECTOR_DEV_EMAIL ?? '').trim().toLowerCase(),
    // Read again on every request (a few lines; an edit needs no restart).
    read: (): GmConnectorFile => {
      if (!file) return EMPTY;
      try {
        const parsed = parseGmConnectorFile(JSON.parse(readFileSync(file, 'utf8')));
        warned = false;
        return parsed;
      } catch {
        if (!warned) {
          warned = true;
          warn('GM connector: the config file cannot be read; every login is refused');
        }
        return EMPTY;
      }
    },
  };
}
