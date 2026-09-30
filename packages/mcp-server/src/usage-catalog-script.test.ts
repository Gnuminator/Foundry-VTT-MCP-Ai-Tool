/**
 * `scripts/usage-catalog.mjs` on fixture trees (it takes `--root`). That the committed
 * `shared/src/usage-catalog.generated.ts` is current is checked by CI (`usage:catalog:check`).
 */
import { spawnSync } from 'child_process';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = path.join(repoRoot, 'scripts', 'usage-catalog.mjs');
const OUT = 'shared/src/usage-catalog.generated.ts';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-catalog-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function put(rel: string, text: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
}

function run(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

async function names(): Promise<
  Array<{ name: string; kind: string; surface: string; file: string }>
> {
  const text = await fsp.readFile(path.join(root, OUT), 'utf8');
  const entries: Array<{ name: string; kind: string; surface: string; file: string }> = [];
  const re = /name: '([^']+)',?\s+kind: '([^']+)',?\s+surface: '([^']+)',?\s+file: '([^']+)'/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    entries.push({ name: m[1], kind: m[2], surface: m[3], file: m[4] });
  }
  return entries;
}

const DASH = 'packages/cogm-dashboard/public';
const MOD = 'packages/foundry-module/src';

describe('usage-catalog script', () => {
  it('finds data-track attributes and literal track calls, sorted, with kind and surface', async () => {
    await put(
      `${DASH}/index.html`,
      [
        '<button data-track="dash.header.tools">Tools</button>',
        '<section data-track="dash.main.view" data-track-kind="view"></section>',
        "<!-- <b data-track='dash.commented.out'> -->",
      ].join('\n')
    );
    await put(
      `${DASH}/app.js`,
      [
        "usage.track('action', 'dash.tools.pick-open');",
        'usage.trackView("dash.tarokka.view");',
        'usage.trackShortcut(`dash.shortcut.escape-modal`);',
        "usage.track('error', 'dash.toast.error', { code: 'x' });",
        "// usage.track('action', 'dash.line.comment');",
        "/* usage.trackView('dash.block.comment'); */",
        'const tpl = `<a data-track="dash.tpl.literal" href="http://x">`;',
      ].join('\n')
    );
    await put(`${DASH}/player.js`, "usage.track('action', 'player.handouts.open');\n");
    await put(
      `${MOD}/chat.ts`,
      "trackUsage('action', 'module.chat.roll-button');\ntrackUsage('error', 'module.error.init', { code: 'a' });\n"
    );
    const r = run();
    expect(r.status).toBe(0);
    const entries = await names();
    expect(entries.map(e => e.name)).toEqual([
      'dash.header.tools',
      'dash.main.view',
      'dash.shortcut.escape-modal',
      'dash.tarokka.view',
      'dash.toast.error',
      'dash.tools.pick-open',
      'dash.tpl.literal',
      'module.chat.roll-button',
      'module.error.init',
      'player.handouts.open',
    ]);
    const by = Object.fromEntries(entries.map(e => [e.name, e]));
    expect(by['dash.header.tools']).toMatchObject({ kind: 'action', surface: 'dashboard' });
    expect(by['dash.main.view']).toMatchObject({ kind: 'view', file: `${DASH}/index.html` });
    expect(by['dash.shortcut.escape-modal']?.kind).toBe('shortcut');
    expect(by['dash.tarokka.view']?.kind).toBe('view');
    expect(by['dash.toast.error']?.kind).toBe('error');
    expect(by['module.chat.roll-button']).toMatchObject({ surface: 'module', kind: 'action' });
    expect(by['player.handouts.open']?.surface).toBe('player');
  });

  it('lists a name used in several files once', async () => {
    await put(`${DASH}/index.html`, '<b data-track="dash.modal.cancel"></b>');
    await put(`${DASH}/app.js`, "usage.track('action', 'dash.modal.cancel');");
    expect(run().status).toBe(0);
    expect((await names()).filter(e => e.name === 'dash.modal.cancel')).toHaveLength(1);
  });

  it('skips tests, the definition files and d.ts files', async () => {
    await put(`${MOD}/chat.test.ts`, "trackUsage('action', 'module.test.only');");
    await put(`${MOD}/usage-recorder.ts`, "trackUsage('action', 'module.example.doc');");
    await put(`${MOD}/types.d.ts`, "trackUsage('action', 'module.types.only');");
    await put(
      `${DASH}/usage.js`,
      "function track(kind, name) {}\ntrack('action', 'dash.def.only');"
    );
    await put(`${MOD}/real.ts`, "trackUsage('action', 'module.real.one');");
    expect(run().status).toBe(0);
    expect((await names()).map(e => e.name)).toEqual(['module.real.one']);
  });

  it('writes an empty catalogue when nothing is found', async () => {
    expect(run().status).toBe(0);
    const text = await fsp.readFile(path.join(root, OUT), 'utf8');
    expect(text).toContain('USAGE_CATALOG: readonly UsageCatalogEntry[] = [];');
  });

  it('--check passes when current and fails (exit 1) when stale or missing', async () => {
    await put(`${DASH}/app.js`, "usage.track('action', 'dash.a.b');");
    expect(run('--check').status).toBe(1);
    expect(run().status).toBe(0);
    expect(run('--check').status).toBe(0);
    await put(`${DASH}/app.js`, "usage.track('action', 'dash.a.b');usage.trackView('dash.c.d');");
    const stale = run('--check');
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('stale');
  });

  it.each([
    ["usage.track('action', name);", 'literal'],
    ['usage.trackView(someVar);', 'literal'],
    ["usage.track('action', 'Bad Name');", 'valid control name'],
    ["usage.track('nope', 'dash.x.y');", 'unknown usage kind'],
    ["usage.track('action', 'tool.x.y');", 'kind "tool"'],
    ["usage.track('action', 'module.x.y');", 'wrong prefix'],
  ])('fails on a bad call (%s)', async (code, message) => {
    await put(`${DASH}/app.js`, code);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain(message);
    expect(r.out).toContain('app.js:1');
  });

  it('fails on a computed data-track name and on a dashboard name in the module', async () => {
    await put(`${DASH}/app.js`, 'const h = `<b data-track="${name}"></b>`;');
    expect(run().out).toContain('not a literal');
    await fsp.rm(path.join(root, DASH), { recursive: true });
    await put(`${MOD}/x.ts`, "trackUsage('action', 'dash.x.y');");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('wrong prefix');
  });
});
