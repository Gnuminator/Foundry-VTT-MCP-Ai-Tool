/**
 * Pre-flight scan (ideas I-067 and I-076, batch 1 lane A): a read-only look at
 * what every client can read before a session starts. Runs on the GM client.
 *
 * - World-scope settings are stored as Setting documents that Foundry sends to
 *   every client, including settings of modules that are installed but not
 *   active. Values that look like secrets are reported with a MASKED value.
 * - Names players can see (playlists and sounds, scenes in the navigation,
 *   tokens on the active scene, journals and pages, actors in the sidebar) go
 *   back as a list; the bridge checks them against the secret terms.
 * - Active modules are checked against a short conflict list.
 *
 * Visibility rules are Foundry 14's own (verified in the v14 client source):
 * `Playlist#visible` is owner or playing and the directory lists a sound when
 * it is owned or playing (`playlist-directory.mjs:391`); scene navigation shows
 * active scenes and `navigation && visible` scenes by `navName || name`
 * (`scene-navigation.mjs:86-98`); `JournalEntry#visible` needs OBSERVER and
 * other documents LIMITED (`client-document.mjs:240`, `journal-entry.mjs:29`).
 *
 * The wire contract is `shared/src/preflight.ts`; only its types are imported
 * (the browser cannot resolve `@gnuminator/shared` at runtime), and the query
 * name is mirrored here (`preflight-scan.contract.test.ts` pins it).
 */
import type {
  PlayerVisibleName,
  PreflightModuleFinding,
  PreflightScan,
  PreflightSettingFinding,
  PreflightSeverity,
} from '@gnuminator/shared';

import { tokenNameForPlayers, UNKNOWN_CREATURE } from './player-visibility.js';

/** Query name (mirror of the shared `PREFLIGHT_QUERY`). */
export const PREFLIGHT_QUERY = 'getPreflightScan';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `collection.contents` read defensively (Foundry `Collection#contents`), else an array as is. */
function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const contents = rec(collection)?.contents;
  return Array.isArray(contents) ? contents : [];
}

// ---------------------------------------------------------------------------
// Secret patterns
// ---------------------------------------------------------------------------

interface SecretPattern {
  rule: string;
  pattern: RegExp;
  severity: 'fail' | 'warn';
  reason: string;
}

/** Shapes of secrets that must never sit where every client can read them. */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    rule: 'discord-webhook',
    pattern: /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/i,
    severity: 'fail',
    reason: 'A Discord webhook URL: any player can read it and post as the webhook.',
  },
  {
    rule: 'slack-webhook',
    pattern: /https:\/\/hooks\.slack\.com\/services\/[\w/]{20,}/i,
    severity: 'fail',
    reason: 'A Slack webhook URL: any player can read it and post as the webhook.',
  },
  {
    rule: 'api-key',
    pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
    severity: 'fail',
    reason: 'Looks like an AI service API key: any player can read it and spend on it.',
  },
  {
    rule: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
    severity: 'fail',
    reason: 'Looks like a GitHub token: any player can read it.',
  },
  {
    rule: 'aws-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'fail',
    reason: 'Looks like an AWS access key: any player can read it.',
  },
  {
    rule: 'google-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: 'fail',
    reason: 'Looks like a Google API key: any player can read it.',
  },
  {
    rule: 'jwt',
    pattern: /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/,
    severity: 'warn',
    reason: 'Looks like a login token (JWT): any player can read it.',
  },
  {
    rule: 'bearer',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
    severity: 'warn',
    reason: 'Looks like a bearer token: any player can read it.',
  },
];

interface KnownSetting {
  setting: string;
  severity: PreflightSeverity;
  reason: string;
}

/** Settings of known modules that hold a secret (vault `Research/Integrations.md`). */
export const KNOWN_SECRET_SETTINGS: readonly KnownSetting[] = [
  {
    setting: 'ddb-importer.cobalt-cookie',
    severity: 'fail',
    reason:
      'Your D&D Beyond login cookie is in a world setting every player can read. In the DDB-Importer settings, keep the cookie in your browser ("cobalt-cookie-local") and clear this one.',
  },
  {
    setting: 'ddb-importer.beta-key',
    severity: 'warn',
    reason: 'The DDB-Importer Patreon key is in a world setting every player can read.',
  },
  {
    setting: 'ddb-importer.patreon-user',
    severity: 'info',
    reason: 'The DDB-Importer Patreon user is in a world setting every player can read.',
  },
  ...['webHookURL', 'rollWebHookURL', 'notesWebHookURL'].map(
    (key): KnownSetting => ({
      setting: `foundrytodiscord.${key}`,
      severity: 'fail',
      reason:
        'Foundry to Discord keeps its webhook URL in a world setting every player can read. Remove the module; the tool posts to Discord without it.',
    })
  ),
];

/** Setting keys whose name suggests a secret; flagged when they hold a long string without spaces. */
const SECRET_KEY_NAME =
  /(?:token|secret|api[-_]?key|apikey|password|passwd|cookie|webhook|bearer|credential)/i;
const MIN_KEY_NAME_VALUE = 12;

/** At most four leading characters and the length; never the value. */
export function maskSecret(value: string): string {
  const head = value.length > 12 ? value.slice(0, 4) : '';
  return `${head}… (${value.length} characters)`;
}

/** Every string inside a setting's stored JSON value (or the raw text when it is not JSON). */
function stringLeaves(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }
  const out: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || out.length > 500) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(item => walk(item, depth + 1));
    else if (v !== null && typeof v === 'object') {
      Object.values(v as Rec).forEach(item => walk(item, depth + 1));
    }
  };
  walk(value, 0);
  return out;
}

/** One stored world setting: `namespace.key` and its raw stored value. */
export interface StoredSetting {
  key: string;
  value: unknown;
}

/** Check stored world settings for secrets. Pure; the result never holds a value in full. */
export function scanSettings(settings: readonly StoredSetting[]): PreflightSettingFinding[] {
  const findings: PreflightSettingFinding[] = [];
  for (const { key: setting, value } of settings) {
    const dot = setting.indexOf('.');
    const namespace = dot > 0 ? setting.slice(0, dot) : setting;
    const name = dot > 0 ? setting.slice(dot + 1) : setting;
    const leaves = stringLeaves(value).filter(s => s.trim().length > 0);
    if (leaves.length === 0) continue;

    const known = KNOWN_SECRET_SETTINGS.find(k => k.setting === setting);
    if (known) {
      const longest = leaves.reduce((a, b) => (b.length > a.length ? b : a));
      findings.push({
        setting,
        namespace,
        rule: `known:${setting}`,
        severity: known.severity,
        reason: known.reason,
        masked: maskSecret(longest),
      });
      continue;
    }

    let matched = false;
    for (const leaf of leaves) {
      for (const p of SECRET_PATTERNS) {
        const hit = p.pattern.exec(leaf);
        if (!hit) continue;
        findings.push({
          setting,
          namespace,
          rule: p.rule,
          severity: p.severity,
          reason: p.reason,
          masked: maskSecret(hit[0]),
        });
        matched = true;
        break;
      }
      if (matched) break;
    }
    if (matched || !SECRET_KEY_NAME.test(name)) continue;
    const candidate = leaves.find(s => s.length >= MIN_KEY_NAME_VALUE && !/\s/.test(s));
    if (candidate) {
      findings.push({
        setting,
        namespace,
        rule: 'key-name',
        severity: 'warn',
        reason:
          'The setting name suggests a secret and it holds a long value; every player can read world settings. Check whether the module can keep it in your browser instead.',
        masked: maskSecret(candidate),
      });
    }
  }
  return findings;
}

/** World-scope Setting documents (`game.settings.storage.get("world")`), user settings left out. */
function storedWorldSettings(): StoredSetting[] {
  const settings = rec(rec(game as unknown)?.settings);
  const storage = settings?.storage;
  const getter = rec(storage)?.get;
  const world: unknown =
    typeof getter === 'function'
      ? (getter as (scope: string) => unknown).call(storage, 'world')
      : null;
  const out: StoredSetting[] = [];
  for (const doc of contentsOf(world)) {
    const d = rec(doc);
    if (!d) continue;
    if (str(d.user)) continue;
    const key = str(d.key);
    if (!key) continue;
    const source = rec(d._source);
    out.push({ key, value: source && 'value' in source ? source.value : d.value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names players can see
// ---------------------------------------------------------------------------

interface PermissionTester {
  testUserPermission?: (user: unknown, level: string) => unknown;
}

function permitted(doc: unknown, user: unknown, level: string): boolean {
  const test = (doc as PermissionTester | null)?.testUserPermission;
  return typeof test === 'function' && test.call(doc, user, level) === true;
}

function players(): unknown[] {
  return contentsOf(game.users).filter(user => rec(user)?.isGM !== true);
}

function anyPlayer(doc: unknown, level: string): boolean {
  return players().some(user => permitted(doc, user, level));
}

function pushName(out: PlayerVisibleName[], name: PlayerVisibleName): void {
  if (name.name.trim().length > 0) out.push(name);
}

/** The names at least one player can see in Foundry right now. */
export function collectPlayerVisibleNames(): PlayerVisibleName[] {
  const out: PlayerVisibleName[] = [];
  const g = rec(game as unknown);

  for (const playlist of contentsOf(g?.playlists)) {
    const p = rec(playlist);
    const id = str(p?.id) ?? '';
    const owned = anyPlayer(playlist, 'OWNER');
    const playing = p?.playing === true;
    if (owned || playing) pushName(out, { kind: 'playlist', id, name: str(p?.name) ?? '' });
    for (const sound of contentsOf(p?.sounds)) {
      const s = rec(sound);
      if (s?.playing === true || anyPlayer(sound, 'OWNER')) {
        pushName(out, { kind: 'sound', id: `${id}.${str(s?.id) ?? ''}`, name: str(s?.name) ?? '' });
      }
    }
  }

  for (const scene of contentsOf(g?.scenes)) {
    const s = rec(scene);
    const shown = s?.active === true || (s?.navigation === true && anyPlayer(scene, 'LIMITED'));
    if (!shown) continue;
    const navName = str(s?.navName);
    pushName(out, {
      kind: 'scene',
      id: str(s?.id) ?? '',
      name: navName && navName.length > 0 ? navName : (str(s?.name) ?? ''),
    });
  }

  const active = rec(rec(g?.scenes)?.current);
  for (const token of contentsOf(active?.tokens)) {
    const t = rec(token);
    if (!t || t.hidden === true) continue;
    const ownedByPlayer = rec(t.actor)?.hasPlayerOwner === true;
    const name = tokenNameForPlayers(t as Parameters<typeof tokenNameForPlayers>[0], ownedByPlayer);
    if (name === UNKNOWN_CREATURE) continue;
    pushName(out, { kind: 'token', id: str(t.id) ?? '', name });
  }

  const playerList = players();
  for (const journal of contentsOf(g?.journal)) {
    const j = rec(journal);
    const readers = playerList.filter(user => permitted(journal, user, 'OBSERVER'));
    if (readers.length === 0) continue;
    const id = str(j?.id) ?? '';
    pushName(out, { kind: 'journal', id, name: str(j?.name) ?? '' });
    for (const page of contentsOf(j?.pages)) {
      if (!readers.some(user => permitted(page, user, 'LIMITED'))) continue;
      const pg = rec(page);
      pushName(out, { kind: 'page', id: `${id}.${str(pg?.id) ?? ''}`, name: str(pg?.name) ?? '' });
    }
  }

  for (const actor of contentsOf(g?.actors)) {
    if (!anyPlayer(actor, 'LIMITED')) continue;
    const a = rec(actor);
    pushName(out, { kind: 'actor', id: str(a?.id) ?? '', name: str(a?.name) ?? '' });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Module conflicts
// ---------------------------------------------------------------------------

interface ModuleRule {
  rule: string;
  /** The module's usual title, shown when it is not installed. */
  name: string;
  ids: readonly string[];
  title?: RegExp;
  severity: 'warn' | 'info';
  reason: string;
  /** Report when the module is NOT active (a recommended module). */
  missing?: boolean;
}

/**
 * The conflict list (vault `Research/Integrations.md`). Finished once the
 * Strahd world's module list exists (I-067); ids are matched first, then titles.
 */
export const MODULE_RULES: readonly ModuleRule[] = [
  {
    rule: 'midi-qol',
    name: 'Midi-QOL',
    ids: ['midi-qol'],
    title: /midi[- ]?qol/i,
    severity: 'warn',
    reason:
      'Midi-QOL does not support dnd5e 6 yet and applies damage on its own path, so the play log misses HP changes and undo doubles up. Switch it off for now.',
  },
  {
    rule: 'battle-flow',
    name: 'Battle Flow',
    ids: ['battleflow', 'fvtt-mod-battleflow', 'battle-flow'],
    title: /battle\s*flow/i,
    severity: 'warn',
    reason:
      'Battle Flow applies damage automatically and touches the same HP changes the play log credits. Test it with the play log before a session.',
  },
  {
    rule: 'foundry-to-discord',
    name: 'Foundry to Discord',
    ids: ['foundrytodiscord'],
    title: /foundry\s*to\s*discord/i,
    severity: 'warn',
    reason:
      'Foundry to Discord keeps webhook URLs where every player can read them and relays raw chat. Remove it.',
  },
  {
    rule: 'npc-narrator',
    name: 'NPC Narrator',
    ids: ['npc-narrator'],
    title: /npc\s*narrator/i,
    severity: 'warn',
    reason: 'NPC Narrator keeps a service token in a world setting every player can read.',
  },
  {
    rule: 'safety-and-communication',
    name: 'Safety and Communication',
    ids: ['safety-and-communication'],
    title: /safety\s*(?:and|&)\s*communication/i,
    severity: 'info',
    reason:
      'Safety and Communication keeps lines and veils in world settings every player can read. Consent Form is the recommended safety tool.',
  },
  {
    rule: 'automated-conditions-5e',
    name: 'Automated Conditions 5e',
    ids: ['automated-conditions-5e'],
    title: /automated\s*conditions\s*5e/i,
    severity: 'info',
    missing: true,
    reason:
      'Automated Conditions 5e is not active: conditions like frightened do not change rolls by themselves.',
  },
];

interface ModuleLike {
  id: string;
  title: string;
  active: boolean;
}

function installedModules(): ModuleLike[] {
  const modules = rec(game as unknown)?.modules;
  const values = rec(modules)?.values;
  const list: unknown[] =
    typeof values === 'function'
      ? Array.from((values as () => Iterable<unknown>).call(modules))
      : contentsOf(modules);
  return list.map(m => {
    const r = rec(m);
    return { id: str(r?.id) ?? '', title: str(r?.title) ?? '', active: r?.active === true };
  });
}

/** Check installed modules against the conflict list. Pure over the given list. */
export function scanModules(modules: readonly ModuleLike[]): PreflightModuleFinding[] {
  const findings: PreflightModuleFinding[] = [];
  for (const rule of MODULE_RULES) {
    const match = modules.find(
      m => rule.ids.includes(m.id) || (rule.title !== undefined && rule.title.test(m.title))
    );
    const active = match?.active === true;
    if (rule.missing ? active : !active) continue;
    findings.push({
      moduleId: match?.id ?? rule.ids[0] ?? rule.rule,
      title: match && match.title.length > 0 ? match.title : rule.name,
      rule: rule.rule,
      severity: rule.severity,
      reason: rule.reason,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

/** `getPreflightScan`: settings, names and modules in one read. GM client only (gated by the caller). */
export function getPreflightScan(): PreflightScan {
  const stored = storedWorldSettings();
  return {
    schema: 1,
    computedAt: Date.now(),
    settingsChecked: stored.length,
    settings: scanSettings(stored),
    names: collectPlayerVisibleNames(),
    modules: scanModules(installedModules()),
  };
}
