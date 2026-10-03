/**
 * "Ready for session" (D3, PB-17): one click on the dashboard turns on the switches an
 * evening at the table needs, and End session turns them off again.
 *
 * - `ready`: turns on each switch in {@link SESSION_SWITCHES} that is off and remembers
 *   which ones it turned on (a hidden world setting, so End works after any restart).
 * - `end`: turns off only what Ready turned on; a switch that was already on before Ready,
 *   or that the GM turned on by hand, stays as it is.
 * - `get` (the default): the switches and what Ready turned on, if anything.
 *
 * Every switch stays a normal module setting the GM can see and change in Foundry. This is
 * not an MCP tool: the bridge reaches it only through a control method the dashboard's GM
 * route calls (`session_switches`), so Claude can never switch on its own writes. It is a
 * non-write for the write gate (write-gate.ts), because it has to work while "Allow Write
 * Operations" is off. GM client only (Foundry lets only a GM change world settings).
 */
import { MODULE_ID } from './constants.js';
import { featureSettingKey, listGuardedFeatures } from './guarded-features.js';
import { LIVE_PLAY_FEATURE_ID } from './live-plan.js';
import { PARTY_FEATURE_ID } from './party-scan.js';
import { TAROKKA_FEATURE_ID } from './tarokka.js';

/** Query name. */
export const SESSION_SWITCHES_QUERY = 'sessionSwitches';

/** The hidden world setting that holds what Ready turned on. */
export const SESSION_READY_SETTING = 'sessionReady';

/** "Allow Write Operations" (settings.ts). */
const WRITES_SETTING = 'allowWriteOperations';

/** The switches Ready turns on, in the order it turns them on (End goes backwards). */
export const SESSION_SWITCHES: ReadonlyArray<{ id: string; setting: string }> = [
  { id: 'writes', setting: WRITES_SETTING },
  { id: 'handouts', setting: featureSettingKey('handouts') },
  { id: LIVE_PLAY_FEATURE_ID, setting: featureSettingKey(LIVE_PLAY_FEATURE_ID) },
  { id: PARTY_FEATURE_ID, setting: featureSettingKey(PARTY_FEATURE_ID) },
  { id: TAROKKA_FEATURE_ID, setting: featureSettingKey(TAROKKA_FEATURE_ID) },
];

/** What Ready turned on and when (ms since epoch). */
export interface SessionReadyRecord {
  at: number;
  turnedOn: string[];
}

export interface SessionSwitch {
  id: string;
  /** The setting's name as Foundry's module settings show it. */
  name: string;
  on: boolean;
}

export interface SessionSwitchesResult {
  switches: SessionSwitch[];
  /** What Ready turned on, or null when the world is not "ready". */
  ready: SessionReadyRecord | null;
  /** Switches this call changed (ready: turned on; end: turned off). */
  changed: string[];
  /** Switches Foundry did not change when asked (the value read back was wrong). */
  failed: string[];
}

/** Register the hidden world setting. Call from the module `init` hook. */
export function registerSessionSwitchSettings(): void {
  game.settings.register(MODULE_ID, SESSION_READY_SETTING, {
    name: 'Ready for session',
    hint: 'Which switches the dashboard\'s "Ready for session" turned on (End session turns them off again).',
    scope: 'world',
    config: false,
    type: Object,
    default: null,
  });
}

function readBool(setting: string): boolean {
  try {
    return game.settings.get(MODULE_ID, setting) === true;
  } catch {
    return false;
  }
}

function readRecord(): SessionReadyRecord | null {
  let raw: unknown;
  try {
    raw = game.settings.get(MODULE_ID, SESSION_READY_SETTING);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { at?: unknown; turnedOn?: unknown };
  const known = new Set(SESSION_SWITCHES.map(s => s.id));
  const turnedOn = Array.isArray(r.turnedOn)
    ? r.turnedOn.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [];
  return { at: typeof r.at === 'number' ? r.at : 0, turnedOn };
}

function switchName(id: string): string {
  if (id === 'writes') return 'Allow Write Operations';
  return listGuardedFeatures().find(f => f.id === id)?.name ?? id;
}

function snapshot(changed: string[], failed: string[]): SessionSwitchesResult {
  return {
    switches: SESSION_SWITCHES.map(s => ({
      id: s.id,
      name: switchName(s.id),
      on: readBool(s.setting),
    })),
    ready: readRecord(),
    changed,
    failed,
  };
}

/** Set one switch and read it back (Foundry can drop a write without an error). */
async function setSwitch(setting: string, on: boolean): Promise<boolean> {
  await game.settings.set(MODULE_ID, setting, on);
  return readBool(setting) === on;
}

async function ready(): Promise<SessionSwitchesResult> {
  const turnedOn = readRecord()?.turnedOn ?? [];
  const changed: string[] = [];
  const failed: string[] = [];
  for (const s of SESSION_SWITCHES) {
    if (readBool(s.setting)) continue;
    if (await setSwitch(s.setting, true)) {
      changed.push(s.id);
      if (!turnedOn.includes(s.id)) turnedOn.push(s.id);
    } else {
      failed.push(s.id);
    }
  }
  const record: SessionReadyRecord = { at: Date.now(), turnedOn };
  await game.settings.set(MODULE_ID, SESSION_READY_SETTING, record);
  return snapshot(changed, failed);
}

async function end(): Promise<SessionSwitchesResult> {
  const record = readRecord();
  const changed: string[] = [];
  const failed: string[] = [];
  if (record) {
    for (const s of [...SESSION_SWITCHES].reverse()) {
      if (!record.turnedOn.includes(s.id) || !readBool(s.setting)) continue;
      if (await setSwitch(s.setting, false)) changed.push(s.id);
      else failed.push(s.id);
    }
    await game.settings.set(MODULE_ID, SESSION_READY_SETTING, null);
  }
  return snapshot(changed, failed);
}

/** The query handler: `{ action: 'get' | 'ready' | 'end' }`. */
export async function sessionSwitches(data: unknown): Promise<SessionSwitchesResult> {
  const action = (data as { action?: unknown } | null | undefined)?.action ?? 'get';
  if (!game.user?.isGM) throw new Error('Only a GM can change the session switches');
  switch (action) {
    case 'get':
      return snapshot([], []);
    case 'ready':
      return await ready();
    case 'end':
      return await end();
    default:
      throw new Error(`Unknown action: ${String(action)}`);
  }
}
