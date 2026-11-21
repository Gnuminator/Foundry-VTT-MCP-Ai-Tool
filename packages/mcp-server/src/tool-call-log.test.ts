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
  skillFields,
  gmCaller,
  pruneCallLogs,
  recordedCallLine,
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

  it('classes a failed call and keeps the message out of the line', () => {
    const fail = (text: string): ReturnType<typeof buildCallLine> =>
      buildCallLine('get-world-info', 0, { content: [{ type: 'text', text }], isError: true }, 5);
    expect(fail('Error: Foundry VTT module not connected. Open the world.').err).toBe(
      'not-connected'
    );
    expect(fail('Error: Not connected to Foundry VTT module.').err).toBe('not-connected');
    expect(fail('Error: request timed out after 30000ms').err).toBe('timeout');
    expect(fail('Handouts are switched off. Ask the GM.').err).toBe('switch-off');
    expect(fail('Error: Invalid arguments: limit expected number').err).toBe('validation');
    expect(fail('Error: something odd').err).toBe('other');
    expect(fail('Query getWorldInfo failed: Query timeout: getWorldInfo').err).toBe('timeout');
    expect(fail('Error: Connection closed').err).toBe('timeout');
    expect(
      fail(
        'Error: send-chat-message: no answer from Foundry in 30 s. The change may or may not have happened'
      ).err
    ).toBe('timeout');
    expect(
      fail(
        'Error: use-item: no answer from Foundry, the link closed first. The change may or may not have happened'
      ).err
    ).toBe('timeout');
    expect(fail('Foundry is not connected, so this request was not sent').err).toBe(
      'not-connected'
    );
    expect(
      fail(
        'The session event log is off (FOUNDRY_AI_EVENT_LOG=off) or the Foundry link is disabled, so there is nothing to wait on.'
      ).err
    ).toBe('switch-off');
    expect(fail('The switch "Handouts" is off').err).toBe('switch-off');
    expect(
      fail('[{"code":"invalid_value","message":"Invalid option: expected one of \\"a\\"|\\"b\\""}]')
        .err
    ).toBe('validation');
    expect(fail('[{"code":"too_small","message":"Too small: expected number"}]').err).toBe(
      'validation'
    );
    // prose that merely says "required" is not a validation error
    expect(fail('Also turned on, because they require Foo; a plan is required').err).toBe('other');
    expect(buildCallLine('x', 0, { content: [], isError: true }, 5).err).toBe('other');
    expect(buildCallLine('x', 0, undefined, 5).err).toBe('other');
    const line = fail('Error: Foundry VTT module not connected: secret text');
    expect(JSON.stringify(line)).not.toContain('secret text');
    // a successful call carries no class
    expect(buildCallLine('x', 0, { content: [] }, 5)).not.toHaveProperty('err');
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
    // A real timestamp: a 1970 line lands in a day file the start-up prune deletes (the race).
    const now = Date.now();
    const a = buildCallLine('x', now, undefined, now + 1);
    expect(await log.record(a)).toBe(true);
    expect(await log.record(a)).toBe(true);
    const dir = path.join(dataDir, TOOL_CALL_LOG_DIR);
    const files = await fsp.readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.calls\.jsonl$/);
    const lines = (await fsp.readFile(path.join(dir, files[0]), 'utf8')).trim().split('\n');
    expect(lines.map(l => JSON.parse(l).tool)).toEqual(['x', 'x']);
  });

  it('deletes day files older than the keep window and nothing else', async () => {
    const dir = path.join(dataDir, TOOL_CALL_LOG_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const now = Date.parse('2026-11-17T12:00:00');
    for (const name of [
      '2026-01-01.calls.jsonl',
      '2026-08-18.calls.jsonl',
      '2026-08-19.calls.jsonl',
      '2026-11-16.calls.jsonl',
      'notes.txt',
    ]) {
      await fsp.writeFile(path.join(dir, name), 'x');
    }
    expect(await pruneCallLogs(dir, now, 90)).toBe(2);
    expect((await fsp.readdir(dir)).sort()).toEqual([
      '2026-08-19.calls.jsonl',
      '2026-11-16.calls.jsonl',
      'notes.txt',
    ]);
    expect(await pruneCallLogs(path.join(dataDir, 'missing'), now)).toBe(0);
  });

  it('builds the record_call line only for an allowed tool, with clamped numbers', () => {
    const allowed = ['get-my-handouts', 'get-my-play-stats'];
    const sent = { tool: 'get-my-handouts', userId: 'abc123', ms: 40, size: 500, ok: true };
    expect(recordedCallLine(sent, allowed, 10_000)).toMatchObject({
      tool: 'get-my-handouts',
      set: 'player',
      ms: 40,
      size: 500,
      ok: true,
      who: 'player',
      userId: 'abc123',
      via: 'connector',
    });
    for (const bad of [
      { tool: 'constructor' },
      { tool: 7 },
      { tool: 'get-world-info' },
      null,
      'x',
    ]) {
      expect(recordedCallLine(bad, allowed)).toBeNull();
    }
    const wild = recordedCallLine(
      { ...sent, ms: 1e12, size: Infinity, userId: 'a b;c', ok: false },
      allowed,
      1e13
    );
    expect(wild).toMatchObject({ ms: 3_600_000, size: 0, ok: false });
    expect(wild).not.toHaveProperty('userId');
    expect(recordedCallLine({ ...sent, ms: -5, size: 1e300 }, allowed)).toMatchObject({
      ms: 0,
      size: 10_000_000,
    });
    expect(recordedCallLine({ tool: 'get-my-play-stats' }, allowed)?.ok).toBe(true);
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

  it('adds who, via, user id, skill and stub when the caller is known', () => {
    const gm = buildCallLine('get-world-info', 0, undefined, 5, { who: 'gm', via: 'connector' });
    expect(gm).toMatchObject({ who: 'gm', via: 'connector' });
    expect(gm).not.toHaveProperty('userId');
    const player = buildCallLine('get-player-skill-guide', 0, undefined, 5, {
      who: 'player',
      userId: 'AbC123xyzAbC123x',
      via: 'connector',
      skill: 'dnd-helper-player',
      stub: 1,
    });
    expect(player).toMatchObject({
      who: 'player',
      userId: 'AbC123xyzAbC123x',
      skill: 'dnd-helper-player',
      stub: 1,
    });
    // A made-up id with punctuation or spaces is dropped; a GM line never carries a user id.
    expect(
      buildCallLine('x', 0, undefined, 5, { who: 'player', userId: 'a b; drop' })
    ).not.toHaveProperty('userId');
    expect(
      buildCallLine('x', 0, undefined, 5, { who: 'gm', userId: 'AbC123xyzAbC123x' })
    ).not.toHaveProperty('userId');
  });

  it('keeps only the skill name and stub revision of a skill guide call', () => {
    expect(
      skillFields('get-skill-guide', {
        skill: 'gm-coach',
        stubRevision: 1,
        page: 'references/x.md',
      })
    ).toEqual({ skill: 'gm-coach', stub: 1 });
    expect(skillFields('get-skill-guide', { skill: 'Typed text!', stubRevision: 'x' })).toEqual({});
    expect(skillFields('get-world-info', { skill: 'gm-coach' })).toEqual({});
    // A slug that looks fine but is not a skill of that tool is typed text: dropped.
    expect(skillFields('get-skill-guide', { skill: 'the-baron-is-the-vampire' })).toEqual({});
    expect(skillFields('get-skill-guide', { skill: 'dnd-helper-player' })).toEqual({});
    expect(skillFields('get-player-skill-guide', { skill: 'dnd-helper-player' })).toEqual({
      skill: 'dnd-helper-player',
    });
    expect(skillFields('get-player-skill-guide', { skill: 'gm-coach' })).toEqual({});
  });

  it('files every call of a dashboard connection as the dashboard, reads included', () => {
    // The dashboard's background reads carry no requestedBy: its hello decides.
    expect(gmCaller(true, undefined, 'get-play-stats', {})).toEqual({
      who: 'gm',
      via: 'dashboard',
    });
    expect(gmCaller(false, 'GM', 'apply-planned-change', {})).toEqual({
      who: 'gm',
      via: 'dashboard',
    });
    expect(gmCaller(false, undefined, 'get-world-info', {})).toEqual({
      who: 'gm',
      via: 'connector',
    });
    expect(gmCaller(false, undefined, 'get-skill-guide', { skill: 'gm-coach' })).toEqual({
      who: 'gm',
      via: 'connector',
      skill: 'gm-coach',
    });
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
