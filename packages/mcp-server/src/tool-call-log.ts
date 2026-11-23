/**
 * Tool call log (D-126, I-113): one JSON line per MCP tool call, so we know which tools are
 * used before trimming the tool sets.
 *
 * Lines go to `<dataDir>/_usage/<local-date>.calls.jsonl` (the leading underscore is not a valid
 * world id, so the vault never mistakes the folder for a world). A line holds the time, tool
 * name, tool set, duration, result size in characters and ok or error. Never arguments, never
 * result text. Since D-146 a line also says who made the call (the GM, or a player's Foundry user
 * id from the verified login) and, for a skill guide, the skill name and stub revision. A write failure is swallowed: logging never breaks a tool call.
 * `FOUNDRY_AI_USAGE_LOG=off` turns it off, like the other usage logs.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { localDateKey } from './event-pump.js';
import { GM_SKILLS, PLAYER_SKILL } from './skill-guide.js';
import { RENAMED_TOOLS } from './param-aliases.js';
import { toolSetOf } from './tool-sets.js';
import type { ToolResultLike } from './tool-router.js';
import { usageLogEnabled } from './usage-log.js';
import { resolveDataDir } from './vault/paths.js';

export const TOOL_CALL_LOG_DIR = '_usage';

/** The client names the tool; a name longer than this is cut in the line. */
const MAX_TOOL_NAME = 80;

/** Who made a call: the GM connector, or one player (a Foundry user id from the verified login). */
export interface CallCaller {
  who: 'gm' | 'player';
  /** The player's Foundry user id (never from tool arguments); absent for the GM. */
  userId?: string;
  /** `connector` (Claude, through a connector) or `dashboard` (a button on the dashboard). */
  via?: 'connector' | 'dashboard';
  /** A skill-guide call's skill name and stub revision (fixed values only, see `skillFields`). */
  skill?: string;
  stub?: number;
}

/** Why a call failed: a fixed list, never the message text (the backend logs that once). */
type ErrorClass = 'not-connected' | 'timeout' | 'switch-off' | 'validation' | 'other';

/** The text of an error result (what Claude receives), empty when there is none. */
export function errorText(result: ToolResultLike | undefined): string {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.map(p => (typeof p?.text === 'string' ? p.text : '')).join(' ');
}

/** Sort an error message into one of the fixed classes. */
function classifyError(text: string): ErrorClass {
  // Switches first: "event log is off ... or the Foundry link is disabled" is a switch, not a link.
  if (/switched off|\bis off\b|turned off|allow write operations/i.test(text)) return 'switch-off';
  if (/not connected|no foundry connection|link is disabled/i.test(text)) return 'not-connected';
  if (/timed? ?out|no answer in|no answer from|did not answer|connection closed/i.test(text))
    return 'timeout';
  if (
    /invalid (arguments?|parameters?|input|option|type|value)|zoderror|validation|expected (string|number|boolean|object|array)|too_(small|big)|invalid_(type|value)/i.test(
      text
    )
  ) {
    return 'validation';
  }
  return 'other';
}

export interface ToolCallLine {
  t: string;
  tool: string;
  set: string;
  ms: number;
  size: number;
  ok: boolean;
  /** Only on a failed call: the class of the error. */
  err?: ErrorClass;
  who?: 'gm' | 'player';
  userId?: string;
  via?: 'connector' | 'dashboard';
  skill?: string;
  stub?: number;
}

const SKILL_GUIDE_TOOLS = new Set(['get-skill-guide', 'get-player-skill-guide']);
const USER_ID_RE = /^[A-Za-z0-9]{1,32}$/;
/** The skills each guide tool serves: a slug outside the list is typed text and is never kept. */
const SKILLS_OF_TOOL: Record<string, readonly string[]> = {
  'get-skill-guide': GM_SKILLS,
  'get-player-skill-guide': [PLAYER_SKILL],
};

/** The skill name and stub revision of a skill-guide call; nothing else of its arguments. */
export function skillFields(tool: string, args: unknown): { skill?: string; stub?: number } {
  if (!SKILL_GUIDE_TOOLS.has(tool) || args === null || typeof args !== 'object') return {};
  const a = args as { skill?: unknown; stubRevision?: unknown };
  const out: { skill?: string; stub?: number } = {};
  if (typeof a.skill === 'string' && SKILLS_OF_TOOL[tool]?.includes(a.skill)) out.skill = a.skill;
  if (typeof a.stubRevision === 'number' && Number.isInteger(a.stubRevision)) {
    out.stub = Math.max(0, Math.min(1000, a.stubRevision));
  }
  return out;
}

/**
 * The caller of a control-channel `call_tool`: the GM, through the dashboard (its connection said
 * hello as `dashboard`, or the call names `requestedBy`) or through a connector (the GM's Claude).
 */
export function gmCaller(
  dashboardConnection: boolean,
  requestedBy: unknown,
  tool: string,
  args: unknown
): CallCaller {
  return {
    who: 'gm',
    via: dashboardConnection || typeof requestedBy === 'string' ? 'dashboard' : 'connector',
    ...skillFields(tool, args),
  };
}

/**
 * The call-log line for a call the dashboard answered itself (`record_call`: `{ tool, userId, ms,
 * size, ok }`). Null unless `tool` is one of `allowed`; `ms` and `size` are clamped, the user id
 * goes through the same filter as every line.
 */
export function recordedCallLine(
  params: unknown,
  allowed: readonly string[],
  now: number = Date.now()
): ToolCallLine | null {
  const rc = (params !== null && typeof params === 'object' ? params : {}) as Record<
    string,
    unknown
  >;
  const tool = rc.tool;
  if (typeof tool !== 'string' || !allowed.includes(tool)) return null;
  const ms = typeof rc.ms === 'number' && rc.ms >= 0 ? Math.min(rc.ms, 3_600_000) : 0;
  const size =
    typeof rc.size === 'number' && Number.isFinite(rc.size) && rc.size >= 0
      ? Math.min(Math.floor(rc.size), 10_000_000)
      : 0;
  const line = buildCallLine(tool, now - ms, { content: [], isError: rc.ok === false }, now, {
    who: 'player',
    ...(typeof rc.userId === 'string' ? { userId: rc.userId } : {}),
    via: 'connector',
  });
  return { ...line, size };
}

/** Characters of text in a tool result (what Claude receives). */
export function resultSize(result: ToolResultLike | undefined): number {
  if (!result || !Array.isArray(result.content)) return 0;
  return result.content.reduce(
    (sum, part) => sum + (typeof part?.text === 'string' ? part.text.length : 0),
    0
  );
}

export function buildCallLine(
  tool: string,
  startedAt: number,
  result: ToolResultLike | undefined,
  now: number = Date.now(),
  caller?: CallCaller
): ToolCallLine {
  const who: Partial<ToolCallLine> = {};
  if (caller) {
    who.who = caller.who;
    if (caller.who === 'player' && caller.userId && USER_ID_RE.test(caller.userId)) {
      who.userId = caller.userId;
    }
    if (caller.via) who.via = caller.via;
    if (caller.skill) who.skill = caller.skill;
    if (caller.stub !== undefined) who.stub = caller.stub;
  }
  const ok = !!result && result.isError !== true;
  return {
    t: new Date(now).toISOString(),
    tool: tool.slice(0, MAX_TOOL_NAME),
    // A renamed tool's old name still routes: it logs under the set of the tool it became.
    set: toolSetOf(RENAMED_TOOLS[tool]?.to ?? tool) ?? 'unknown',
    ms: Math.max(0, Math.round(now - startedAt)),
    size: resultSize(result),
    ok,
    ...(ok ? {} : { err: classifyError(errorText(result)) }),
    ...who,
  };
}

/** Day files older than this are deleted (the usage reports look back weeks, not months). */
const CALL_LOG_KEEP_DAYS = 90;

const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.calls\.jsonl$/;

/** Delete the `<date>.calls.jsonl` files in `dir` older than `keepDays`; returns how many went. */
export async function pruneCallLogs(
  dir: string,
  now: number = Date.now(),
  keepDays: number = CALL_LOG_KEEP_DAYS
): Promise<number> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = localDateKey(now - keepDays * 86_400_000);
  let removed = 0;
  for (const name of names) {
    const day = DAY_FILE_RE.exec(name)?.[1];
    if (!day || day >= cutoff) continue;
    try {
      await fsp.rm(path.join(dir, name));
      removed++;
    } catch {
      // a locked or already gone file stays for the next start
    }
  }
  return removed;
}

export class ToolCallLog {
  readonly enabled: boolean;
  private readonly dir: string;
  private dirReady = false;

  constructor(options: { dataDir?: string; enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? usageLogEnabled();
    this.dir = path.join(options.dataDir ?? resolveDataDir(), TOOL_CALL_LOG_DIR);
  }

  /** Fire and forget; resolves to whether the line was written. Never rejects. */
  record(line: ToolCallLine): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false);
    return (async (): Promise<boolean> => {
      try {
        if (!this.dirReady) {
          await fsp.mkdir(this.dir, { recursive: true });
          this.dirReady = true;
          // Once per process: old day files go (the Pi has no other cleanup).
          void pruneCallLogs(this.dir).catch(() => undefined);
        }
        const file = path.join(this.dir, `${localDateKey(Date.parse(line.t))}.calls.jsonl`);
        await fsp.appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
        return true;
      } catch {
        this.dirReady = false;
        return false;
      }
    })();
  }
}

/**
 * Run one tool call, log what it returned (the final result Claude gets, an error result
 * included), and return that result. `run` is expected to turn its own failures into an error
 * result; if it throws anyway the call is logged as an error and `onError` builds the result.
 * Logging never changes or delays the result.
 */
export async function runLoggedCall<T extends ToolResultLike>(
  log: Pick<ToolCallLog, 'record'>,
  tool: string,
  run: () => Promise<T>,
  onError: (error: unknown) => T,
  caller?: CallCaller
): Promise<T> {
  const startedAt = Date.now();
  let result: T;
  try {
    result = await run();
  } catch (error) {
    result = onError(error);
  }
  try {
    void Promise.resolve(
      log.record(buildCallLine(tool, startedAt, result, Date.now(), caller))
    ).catch(() => undefined);
  } catch {
    // logging never breaks a tool call
  }
  return result;
}
