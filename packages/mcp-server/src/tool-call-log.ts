/**
 * Tool call log (D-126, I-113): one JSON line per MCP tool call, so we know which tools are
 * used before trimming the tool sets.
 *
 * Lines go to `<dataDir>/_usage/<local-date>.calls.jsonl` (the leading underscore is not a valid
 * world id, so the vault never mistakes the folder for a world). A line holds the time, tool
 * name, tool set, duration, result size in characters and ok or error. Never arguments, never
 * result text. A write failure is swallowed: logging never breaks a tool call.
 * `FOUNDRY_AI_USAGE_LOG=off` turns it off, like the other usage logs.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { localDateKey } from './event-pump.js';
import { toolSetOf } from './tool-sets.js';
import type { ToolResultLike } from './tool-router.js';
import { usageLogEnabled } from './usage-log.js';
import { resolveDataDir } from './vault/paths.js';

export const TOOL_CALL_LOG_DIR = '_usage';

/** The client names the tool; a name longer than this is cut in the line. */
const MAX_TOOL_NAME = 80;

export interface ToolCallLine {
  t: string;
  tool: string;
  set: string;
  ms: number;
  size: number;
  ok: boolean;
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
  now: number = Date.now()
): ToolCallLine {
  return {
    t: new Date(now).toISOString(),
    tool: tool.slice(0, MAX_TOOL_NAME),
    set: toolSetOf(tool) ?? 'unknown',
    ms: Math.max(0, Math.round(now - startedAt)),
    size: resultSize(result),
    ok: !!result && result.isError !== true,
  };
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
  onError: (error: unknown) => T
): Promise<T> {
  const startedAt = Date.now();
  let result: T;
  try {
    result = await run();
  } catch (error) {
    result = onError(error);
  }
  try {
    void Promise.resolve(log.record(buildCallLine(tool, startedAt, result))).catch(() => undefined);
  } catch {
    // logging never breaks a tool call
  }
  return result;
}
