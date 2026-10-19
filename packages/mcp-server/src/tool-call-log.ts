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
    tool,
    set: toolSetOf(tool) ?? 'unknown',
    ms: Math.max(0, Math.round(now - startedAt)),
    size: resultSize(result),
    ok: !!result && result.isError !== true,
  };
}

export class ToolCallLog {
  readonly enabled: boolean;
  private readonly dir: string;

  constructor(options: { dataDir?: string; enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? usageLogEnabled();
    this.dir = path.join(options.dataDir ?? resolveDataDir(), TOOL_CALL_LOG_DIR);
  }

  /** Fire and forget; resolves to whether the line was written. Never rejects. */
  record(line: ToolCallLine): Promise<boolean> {
    if (!this.enabled) return Promise.resolve(false);
    return (async (): Promise<boolean> => {
      try {
        await fsp.mkdir(this.dir, { recursive: true });
        const file = path.join(this.dir, `${localDateKey(Date.parse(line.t))}.calls.jsonl`);
        await fsp.appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
        return true;
      } catch {
        return false;
      }
    })();
  }
}
