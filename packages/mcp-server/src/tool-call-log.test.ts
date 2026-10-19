import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  TOOL_CALL_LOG_DIR,
  ToolCallLog,
  buildCallLine,
  resultSize,
  runLoggedCall,
} from './tool-call-log.js';
import { TOOL_SETS } from './tool-sets.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'toolcalls-'));
});
afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('tool call log', () => {
  it('builds a line without arguments or text', () => {
    const tool = TOOL_SETS.core.tools[0];
    const line = buildCallLine(tool, 1000, { content: [{ type: 'text', text: 'hello' }] }, 1250);
    expect(line).toMatchObject({ tool, set: 'core', ms: 250, size: 5, ok: true });
    expect(Object.keys(line).sort()).toEqual(['ms', 'ok', 'set', 'size', 't', 'tool']);
  });

  it('marks a missing or error result as not ok and unknown tools as unknown', () => {
    expect(buildCallLine('nope', 0, undefined, 5)).toMatchObject({
      set: 'unknown',
      ok: false,
      size: 0,
    });
    expect(buildCallLine('nope', 0, { content: [], isError: true }, 5).ok).toBe(false);
    expect(resultSize({ content: [{ type: 'image' }, { type: 'text', text: 'ab' }] })).toBe(2);
  });

  it('appends one JSON line per call under _usage', async () => {
    const log = new ToolCallLog({ dataDir, enabled: true });
    const a = buildCallLine('x', 0, undefined, 1);
    expect(await log.record(a)).toBe(true);
    expect(await log.record(a)).toBe(true);
    const dir = path.join(dataDir, TOOL_CALL_LOG_DIR);
    const files = await fsp.readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.calls\.jsonl$/);
    const lines = (await fsp.readFile(path.join(dir, files[0]), 'utf8')).trim().split('\n');
    expect(lines.map(l => JSON.parse(l).tool)).toEqual(['x', 'x']);
  });

  it('cuts a very long client-supplied tool name', () => {
    expect(buildCallLine('x'.repeat(500), 0, undefined, 5).tool).toHaveLength(80);
  });

  it('runLoggedCall logs the result it returns and survives a failing log', async () => {
    const seen: unknown[] = [];
    const log = {
      record: (line: unknown): Promise<boolean> => {
        seen.push(line);
        return Promise.reject(new Error('disk full'));
      },
    };
    const ok = await runLoggedCall(
      log,
      'get-world-info',
      () => Promise.resolve({ content: [{ type: 'text', text: 'abc' }] }),
      () => ({ content: [], isError: true })
    );
    expect(ok.content[0].text).toBe('abc');
    expect(seen[0]).toMatchObject({ tool: 'get-world-info', set: 'core', size: 3, ok: true });
  });

  it('runLoggedCall logs a throwing run as an error with the error result', async () => {
    const seen: Array<{ ok: boolean; size: number }> = [];
    const log = {
      record: (line: { ok: boolean; size: number }): Promise<boolean> => {
        seen.push(line);
        return Promise.resolve(true);
      },
    };
    const res = await runLoggedCall(
      log,
      'get-party',
      () => Promise.reject(new Error('cap failed')),
      () => ({ content: [{ type: 'text', text: 'Error: x' }], isError: true })
    );
    expect(res.isError).toBe(true);
    expect(seen[0]).toMatchObject({ ok: false, size: 8 });
  });

  it('writes nothing when off and never throws on a write failure', async () => {
    const line = buildCallLine('x', 0, undefined, 1);
    expect(await new ToolCallLog({ dataDir, enabled: false }).record(line)).toBe(false);
    await expect(fsp.readdir(path.join(dataDir, TOOL_CALL_LOG_DIR))).rejects.toThrow();
    const blocker = path.join(dataDir, 'file');
    await fsp.writeFile(blocker, 'x');
    expect(await new ToolCallLog({ dataDir: blocker, enabled: true }).record(line)).toBe(false);
  });
});
