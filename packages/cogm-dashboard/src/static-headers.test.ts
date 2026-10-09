/**
 * Page headers that no URL spelling can skip (static-headers.ts). The player
 * page's CSP used to come from a `req.path` check, so `/player%2Ehtml`,
 * `/Player.html` (case-insensitive file system) and `/x/../player.html` served
 * `public/player.html` without it. Requests go through `http.request` so the
 * raw path reaches the server exactly as written.
 */
import { statSync } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard, PLAYER_CSP, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';
import { OPEN_PAGE_CSP } from './open-route.js';
import { staticHeaders, type BigStat, type StaticHeaderGroup } from './static-headers.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

const fakeClient = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.reject(new Error('no bridge in this test')),
};

let dashboard: Dashboard;
let server: http.Server;
let port = 0;

beforeAll(async () => {
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: 'gm-token', playerToken: '' },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'static-headers-test'),
    client: fakeClient,
    coGm: fakeCoGm,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  dashboard.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

function get(rawPath: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: rawPath, agent: false },
      res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** A response stand-in that records the headers a hook sets. */
function recorder(): { res: http.ServerResponse; set: Record<string, string> } {
  const set: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string): void => {
      set[name] = value;
    },
  } as unknown as http.ServerResponse;
  return { res, set };
}

describe('the player page CSP on every URL that serves it', () => {
  it('sends the CSP on the page and every alias that must serve it', async () => {
    for (const p of [
      '/player',
      '/player?x=1',
      '/player/',
      '/PLAYER',
      '/Player/',
      '/player.html',
      '/player.html?x=1',
      '/player%2Ehtml',
      '/player%2ehtml',
      '/%70layer.html',
      '/x/../player.html',
      '/x/%2E%2E/player.html',
      '/./player.html',
    ]) {
      const answer = await get(p);
      expect([p, answer.status]).toEqual([p, 200]);
      expect([p, answer.headers['content-security-policy']]).toEqual([p, PLAYER_CSP]);
      expect(answer.text).toContain('<script src="player.js"');
    }
  });

  it('sends it on every alias the file system resolves (case, short names, dots)', async () => {
    let served = 0;
    for (const p of [
      '/PLAYER.HTML',
      '/Player.html',
      '/player.HTML',
      '/PLAYER~1.HTM',
      '/player.html.',
      '/player.html%20',
      '/player.html::$DATA',
    ]) {
      const answer = await get(p);
      if (answer.status !== 200) continue;
      served += 1;
      expect([p, answer.headers['content-security-policy']]).toEqual([p, PLAYER_CSP]);
    }
    // On Windows (NTFS) the case aliases, the 8.3 short name and the `::$DATA` stream are
    // served (the last two caught by file identity); a trailing dot or space is not.
    if (process.platform === 'win32') expect(served).toBeGreaterThanOrEqual(3);
  });

  it('leaves the other pages their own headers', async () => {
    const index = await get('/');
    expect(index.status).toBe(200);
    expect(index.headers['content-security-policy']).toBeUndefined();
    for (const p of ['/index.html', '/app.js', '/player.js', '/styles.css']) {
      const answer = await get(p);
      expect([p, answer.status]).toEqual([p, 200]);
      expect([p, answer.headers['content-security-policy']]).toEqual([p, undefined]);
    }
    for (const p of ['/open', '/open.html', '/OPEN.HTML', '/open%2Ehtml', '/x/../open.html']) {
      const answer = await get(p);
      if (p === '/OPEN.HTML' && answer.status !== 200) continue;
      expect([p, answer.status]).toEqual([p, 200]);
      expect([p, answer.headers['content-security-policy']]).toEqual([p, OPEN_PAGE_CSP]);
    }
  });
});

describe('staticHeaders', () => {
  const player: StaticHeaderGroup = {
    files: ['player.html'],
    apply: res => res.setHeader('X-Group', 'player'),
  };
  const open: StaticHeaderGroup = {
    files: ['open.html', 'open.js'],
    apply: res => res.setHeader('X-Other', 'open'),
  };
  const statOf = (name: string): unknown => statSync(path.join(PUBLIC_DIR, name));

  it('matches a group by file name, case-insensitively', () => {
    const hook = staticHeaders(PUBLIC_DIR, [player, open]);
    for (const name of ['player.html', 'PLAYER.HTML', 'Player.Html']) {
      const { res, set } = recorder();
      hook(res, path.join(PUBLIC_DIR, name), undefined);
      expect(set).toEqual({ 'X-Group': 'player' });
    }
    const { res, set } = recorder();
    hook(res, path.join(PUBLIC_DIR, 'OPEN.JS'), undefined);
    expect(set).toEqual({ 'X-Other': 'open' });
  });

  it('matches a group by file identity, whatever the name', () => {
    const hook = staticHeaders(PUBLIC_DIR, [player, open]);
    const { res, set } = recorder();
    hook(res, 'C:\\public\\PLAYER~1.HTM', statOf('player.html'));
    expect(set).toEqual({ 'X-Group': 'player' });
    const other = recorder();
    hook(other.res, 'C:\\public\\OPEN~1.HTM', statOf('open.html'));
    expect(other.set).toEqual({ 'X-Other': 'open' });
  });

  it('tells files apart whose NTFS ids round to the same number', () => {
    // A reuse counter above 31 puts the id over 2^53; 2^58 + 5 and 2^58 + 6 are one double.
    const exact: Record<string, { dev: bigint; ino: bigint }> = {
      'player.html': { dev: 7n, ino: 2n ** 58n + 5n },
      'player.js': { dev: 7n, ino: 2n ** 58n + 6n },
      'PLAYER~1.HTM': { dev: 7n, ino: 2n ** 58n + 5n },
    };
    const statBig: BigStat = filePath => {
      const id = exact[path.basename(filePath)];
      if (!id) throw new Error(`ENOENT ${filePath}`);
      return id;
    };
    const rounded = (name: string): unknown => ({
      dev: Number(exact[name].dev),
      ino: Number(exact[name].ino),
    });
    expect(rounded('player.js')).toEqual(rounded('player.html'));

    const hook = staticHeaders(PUBLIC_DIR, [player], statBig);
    const js = recorder();
    hook(js.res, path.join(PUBLIC_DIR, 'player.js'), rounded('player.js'));
    expect(js.set).toEqual({});
    const short = recorder();
    hook(short.res, path.join(PUBLIC_DIR, 'PLAYER~1.HTM'), rounded('PLAYER~1.HTM'));
    expect(short.set).toEqual({ 'X-Group': 'player' });
    const gone = recorder();
    hook(gone.res, path.join(PUBLIC_DIR, 'deleted.bin'), rounded('player.html'));
    expect(gone.set).toEqual({});
  });

  it('leaves every other file alone, and survives odd stat values', () => {
    const hook = staticHeaders(PUBLIC_DIR, [player, open]);
    for (const name of ['index.html', 'player.js', 'styles.css']) {
      const { res, set } = recorder();
      hook(res, path.join(PUBLIC_DIR, name), statOf(name));
      expect([name, set]).toEqual([name, {}]);
    }
    for (const stat of [undefined, null, {}, { dev: '1', ino: '2' }, 42]) {
      const { res, set } = recorder();
      hook(res, path.join(PUBLIC_DIR, 'index.html'), stat);
      expect(set).toEqual({});
    }
  });

  it('keeps the name check for a file that does not exist at startup', () => {
    const hook = staticHeaders(PUBLIC_DIR, [
      {
        files: ['not-there.html'],
        apply: (res): void => {
          res.setHeader('X-Missing', 'yes');
        },
      },
    ]);
    const { res, set } = recorder();
    hook(res, path.join(PUBLIC_DIR, 'NOT-THERE.html'), undefined);
    expect(set).toEqual({ 'X-Missing': 'yes' });
  });
});
