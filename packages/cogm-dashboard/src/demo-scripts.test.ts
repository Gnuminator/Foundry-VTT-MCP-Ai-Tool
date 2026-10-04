/**
 * The demo take helpers in `scripts/demo/` (I-082): the dashboard element ids they click
 * must still exist in the dashboard, the OBS WebSocket auth must match the protocol's
 * worked example, the OBS ini editor must keep every line it does not change, and the
 * export's YouTube chapters and clip bitrate must follow their rules.
 */
import { promises as fsp, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demoLib = (name: string): string =>
  pathToFileURL(path.join(repoRoot, 'scripts', 'demo', 'lib', name)).href;
const demoExport = pathToFileURL(path.join(repoRoot, 'scripts', 'demo', 'export.mjs')).href;
// A UTF-8 byte order mark, as OBS may write at the start of its ini files.
const BOM = String.fromCharCode(0xfeff);

describe('demo dashboard helpers', () => {
  it('only use element ids that the dashboard page has', () => {
    const helpers = readFileSync(
      path.join(repoRoot, 'scripts', 'demo', 'lib', 'dashboard.mjs'),
      'utf8'
    );
    const page = readFileSync(
      path.join(repoRoot, 'packages', 'cogm-dashboard', 'public', 'index.html'),
      'utf8'
    );
    const ids = [...new Set([...helpers.matchAll(/#([a-z][a-z0-9-]*)/g)].map(m => m[1]))];
    expect(ids.length).toBeGreaterThan(5);
    const missing = ids.filter(id => !page.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });
});

describe('demo worlds', () => {
  it('takes run in ai-tool-demo or another ai-tool-demo-<name> world, never a test world', async () => {
    const { demoWorld } = await import(demoLib('env.mjs'));
    const saved = process.env.DEMO_WORLD_ID;
    try {
      delete process.env.DEMO_WORLD_ID;
      expect(demoWorld()).toBe('ai-tool-demo');
      process.env.DEMO_WORLD_ID = 'ai-tool-demo-gm';
      expect(demoWorld()).toBe('ai-tool-demo-gm');
      for (const world of ['ai-tool-test', 'ai-tool-kit', 'ai-tool-demo-', 'AI-TOOL-DEMO', 'x']) {
        process.env.DEMO_WORLD_ID = world;
        expect(() => demoWorld()).toThrow(/Demo worlds/);
      }
    } finally {
      if (saved === undefined) delete process.env.DEMO_WORLD_ID;
      else process.env.DEMO_WORLD_ID = saved;
    }
  });

  it('hands takes kept outside the repo the same helpers', async () => {
    const lib = (await import(demoLib('index.mjs'))) as Record<string, unknown>;
    for (const name of ['humanClick', 'runPreflight', 'callToolApi', 'joinFoundry', 'demoWorld']) {
      expect(typeof lib[name]).toBe('function');
    }
  });
});

describe('OBS WebSocket auth', () => {
  it('matches the worked example of obs-websocket protocol v5', async () => {
    const { obsAuth } = await import(demoLib('obs.mjs'));
    expect(
      obsAuth(
        'supersecretpassword',
        'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=',
        '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY='
      )
    ).toBe('1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
  });
});

describe('OBS profile ini editor', () => {
  it('sets keys, adds missing ones and sections, keeps the rest and the BOM', async () => {
    const { editIni } = await import(demoLib('obs-setup.mjs'));
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'demo-ini-'));
    const file = path.join(dir, 'basic.ini');
    const before = `${BOM}[General]\r\nName=Demo\r\n\r\n[Video]\r\nBaseCX=1920\r\nBaseCY=1080\r\n\r\n[Audio]\r\n`;
    await fsp.writeFile(file, before, 'utf8');
    try {
      editIni(file, {
        Video: { BaseCX: '3840', FPSNum: '60' },
        SimpleOutput: { RecFormat2: 'hybrid_mp4' },
      });
      const after = await fsp.readFile(file, 'utf8');
      expect(after.startsWith(`${BOM}[General]\r\nName=Demo\r\n`)).toBe(true);
      expect(after).toContain('[Video]\r\nBaseCX=3840\r\nBaseCY=1080\r\nFPSNum=60\r\n');
      expect(after).toContain('[Audio]');
      expect(after).toContain('[SimpleOutput]\r\nRecFormat2=hybrid_mp4');
      expect(after).not.toMatch(/(^|[^\r])\n/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('demo export', () => {
  it('formats chapter times the way YouTube reads them', async () => {
    const { formatTime } = await import(demoExport);
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9.9)).toBe('0:09');
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('starts chapters at 0:00 and merges steps shorter than 10 seconds', async () => {
    const { chapters } = await import(demoExport);
    const steps = [
      { step: 'a', title: 'Open', start: 1, end: 4 },
      { step: 'b', title: 'Plan', start: 4, end: 15 },
      { step: 'c', title: 'Apply', start: 15, end: 30 },
      { step: 'd', title: 'Undo', start: 30, end: 33 },
    ];
    const { lines, problems } = chapters(steps, 34);
    expect(lines).toEqual(['0:00 Open; Plan', '0:15 Apply; Undo']);
    expect(problems).toHaveLength(1);
    const long = chapters(
      [
        { step: 'a', title: 'One', start: 1, end: 20 },
        { step: 'b', title: 'Two', start: 20, end: 40 },
        { step: 'c', title: 'Three', start: 40, end: 60 },
      ],
      61
    );
    expect(long.lines).toEqual(['0:00 One', '0:20 Two', '0:40 Three']);
    expect(long.problems).toEqual([]);
  });

  it('picks a clip bitrate that leaves headroom under the size limit', async () => {
    const { clipBitrate } = await import(demoExport);
    const bps = clipBitrate(20, 10_000_000);
    expect((bps * 20) / 8).toBeLessThan(10_000_000 * 0.9);
    expect(clipBitrate(1, 10_000_000)).toBe(12_000_000);
  });
});
