/**
 * The demo take helpers in `scripts/demo/` (I-082): the dashboard element ids they click
 * must still exist in the dashboard, the OBS WebSocket auth must match the protocol's
 * worked example, and the OBS ini editor must keep every line it does not change.
 */
import { promises as fsp, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const demoLib = (name: string): string =>
  pathToFileURL(path.join(repoRoot, 'scripts', 'demo', 'lib', name)).href;
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
