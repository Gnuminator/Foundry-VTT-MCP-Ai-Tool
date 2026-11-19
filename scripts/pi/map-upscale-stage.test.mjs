// Pi stage 34, the sharper adventure maps (scripts/pi/remote/34-map-upscale.sh, backlog map-upscale-pi), its GM script and the
// PC-side prepare tool:
//   node --test scripts/pi/map-upscale-stage.test.mjs
// The text and prepare checks always run; PI_STAGE34_CONTAINER=1 (needs Docker) runs the scenarios in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';
import { buildData, dataJs, sha256File } from './map-upscale/prepare.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(path.join(repo, p), 'utf8');
const stage = read('scripts/pi/remote/34-map-upscale.sh');
const gm = read('scripts/pi/remote/map-upscale-scenes.js');

describe('34-map-upscale.sh as text', () => {
  test('the snapshot comes before the first write, check and scenes-check need none', () => {
    const snap = stage.indexOf('require_recent_snapshot');
    assert.ok(snap > 0 && snap < stage.indexOf('# ---- changes start here'));
    // the GM modes want it only for a real run
    assert.match(
      stage,
      /\[ "\$MODE" = scenes-check \] \|\| \[ -z "\$\{APPLY:-\}" \] \|\| require_recent_snapshot/
    );
    assert.match(stage, /check \| scenes-check\)\n\s+\[ -z "\$\{APPLY:-\}" \] \|\| die/);
  });

  test('deletes nothing and writes only as the foundry user', () => {
    const code = stage
      .split('\n')
      .filter(l => !l.trim().startsWith('#'))
      .join('\n');
    assert.deepEqual(code.match(/\brm -\w+ \S+/g), ['rm -f "$t"']);
    assert.doesNotMatch(code, /-delete|rmdir|rm -rf|\bcp -r|\bcp -a/);
    const changes = stage.slice(
      stage.indexOf('# ---- changes start here'),
      stage.indexOf('scale | switch | revert | scenes-check)')
    );
    assert.doesNotMatch(changes, /^\s*(cp|mv|chmod|chown|install|mkdir|tee)\b/m);
    assert.match(changes, /runuser -u "\$FOUNDRY_USER" -- mkdir -p "\$dest"/);
  });

  test('never writes into ddb-images (the originals)', () => {
    for (const l of stage.split('\n')) {
      if (/\b(cp|mv|runuser|rm|chmod)\b/.test(l) && !l.trim().startsWith('#'))
        assert.doesNotMatch(l, /ddb-images/, l);
    }
    assert.match(stage, /FOLDER:-assets\/strahd-maps-2x/);
  });

  test('a real GM run needs a dry run mode first: the stage defaults to the dry run and exports DRY_RUN', () => {
    assert.match(
      stage,
      /if \[ "\$MODE" = scenes-check \] \|\| \[ -z "\$\{APPLY:-\}" \]; then\n\s+DRY_RUN=1/
    );
    assert.match(stage, /export GM_SCRIPT DRY_RUN/);
  });

  test('switch needs the files installed and verified; the stage refuses a data.js for another folder', () => {
    assert.match(stage, /\[ "\$map_mode" = switch \]/);
    assert.match(stage, /run MODE=files first/);
    assert.match(stage, /grep -q "\\"\$FOLDER\/" "\$SRC\/data\.js"/);
  });

  test('holds no book content: no scene names, map names or paths of the adventure', () => {
    for (const text of [stage, gm, read('scripts/pi/map-upscale/prepare.mjs')]) {
      assert.doesNotMatch(text, /Ravenloft|Vallaki|Barovia|Krezk|map-\d\d\.|Curse_of/);
    }
  });
});

describe('map-upscale-scenes.js', () => {
  test('refuses to run without the mode and data, and never writes in check', () => {
    assert.match(gm, /typeof MAP_MODE === 'undefined' \|\| typeof DATA === 'undefined'/);
    assert.match(gm, /MAP_MODE === 'check' && !args\.dryRun\)\s+throw/);
    assert.match(gm, /const write = !args\.dryRun && MAP_MODE !== 'check'/);
  });

  test('changes a value only when it is the imported one, fails the run on anything unexpected', () => {
    assert.match(gm, /neither/);
    assert.match(gm, /counts\.unexpected \|\| counts\.missing \|\| counts\.unreachable/);
  });

  test('run against a fake world: scale, switch and revert are exact and idempotent', async () => {
    const mk = init => {
      const scenes = init.map(s => {
        const levels = s.levels.map((src, i) => ({
          id: `l${i}`,
          name: `L${i}`,
          background: { src },
        }));
        const scene = {
          name: s.name,
          width: s.width,
          height: s.height,
          grid: { ...s.grid },
          levels: Object.assign(levels, { size: levels.length }),
          async update(d) {
            if (d.width) this.width = d.width;
            if (d.height) this.height = d.height;
            if (d.grid) Object.assign(this.grid, d.grid);
          },
          async updateEmbeddedDocuments(_k, ups) {
            for (const u of ups)
              levels.find(l => l.id === u._id).background.src = u['background.src'];
          },
        };
        return scene;
      });
      return Object.assign(scenes, { getName: n => scenes.find(s => s.name === n) });
    };
    const AF = Object.getPrototypeOf(async function () {}).constructor;
    const data = {
      switch: { 'orig/a.jpg': 'assets/x/a.jpg', 'orig/b.jpg': 'assets/x/b.jpg' },
      size: [{ name: 'S1', from: [2000, 2000], to: [10, 20] }],
      grid: [{ name: 'G1', from: { size: 140 }, to: { size: 70 } }],
    };
    const world = mk([
      { name: 'S1', width: 2000, height: 2000, grid: { size: 100 }, levels: ['orig/a.jpg'] },
      { name: 'G1', width: 5, height: 5, grid: { size: 140 }, levels: ['orig/b.jpg'] },
      { name: 'Odd', width: 5, height: 5, grid: { size: 1 }, levels: ['other.jpg'] },
    ]);
    globalThis.game = { scenes: world };
    globalThis.fetch = async () => ({ ok: true });
    const run = async (mode, dryRun) => {
      const lines = [];
      try {
        const r = await new AF(
          'args',
          `const MAP_MODE = '${mode}'; const DATA = ${JSON.stringify(data)};\n${gm}`
        )({
          dryRun,
          log: m => lines.push(m),
        });
        return { r, lines };
      } catch (e) {
        return { err: e.message, lines };
      }
    };
    let x = await run('scale', true);
    assert.equal(x.r.counts.wouldChange, 2);
    assert.equal(world[0].width, 2000, 'a dry run writes nothing');
    x = await run('scale', false);
    assert.equal(x.r.counts.changed, 2);
    assert.deepEqual([world[0].width, world[0].height, world[1].grid.size], [10, 20, 70]);
    x = await run('scale', false);
    assert.equal(x.r.counts.changed, 0);
    assert.equal(x.r.counts.already, 2);
    x = await run('switch', false);
    assert.equal(x.r.counts.changed, 2);
    assert.equal(world[0].levels[0].background.src, 'assets/x/a.jpg');
    x = await run('switch', false);
    assert.equal(x.r.counts.changed, 0);
    x = await run('revert', false);
    assert.equal(x.r.counts.changed, 2);
    assert.equal(world[1].levels[0].background.src, 'orig/b.jpg');
    // an unreachable 2x file is not switched and fails the run
    globalThis.fetch = async () => ({ ok: false });
    x = await run('switch', false);
    assert.match(x.err, /not clean/);
    assert.equal(world[0].levels[0].background.src, 'orig/a.jpg');
    globalThis.fetch = async () => ({ ok: true });
    // a scene with other values is left alone and the run fails
    world[0].width = 777;
    x = await run('scale', false);
    assert.match(x.err, /not clean/);
    assert.equal(world[0].width, 777);
    // check never runs for real
    x = await run('check', false);
    assert.match(x.err, /read-only/);
    delete globalThis.game;
    delete globalThis.fetch;
  });
});

describe('prepare.mjs', () => {
  const jpg = (dir, name, n = 2000) =>
    writeFileSync(
      path.join(dir, name),
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)])
    );
  const setup = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mu-'));
    mkdirSync(path.join(dir, 'maps'));
    jpg(path.join(dir, 'maps'), 'a.jpg');
    jpg(path.join(dir, 'maps'), 'b.jpg');
    return path.join(dir, 'maps');
  };
  const base = mapsDir => ({
    switchMap: { 'orig/a.png': 'a.jpg', 'orig/b.jpg': 'b.jpg' },
    scale: {
      size: [{ name: 'S', from: [1, 2], to: [3, 4] }],
      grid: [{ name: 'G', from: { size: 1 }, to: { size: 2 } }],
    },
    folder: 'assets/strahd-maps-2x',
    mapsDir,
  });

  test('builds DATA with the new paths under the folder, and a manifest-ready file list', async () => {
    const m = setup();
    const { data, files } = buildData(base(m));
    assert.deepEqual(files, ['a.jpg', 'b.jpg']);
    assert.equal(data.switch['orig/a.png'], 'assets/strahd-maps-2x/a.jpg');
    assert.match(dataJs(data), /^const DATA = \{/);
    assert.match(await sha256File(path.join(m, 'a.jpg')), /^[0-9a-f]{64}$/);
  });

  test('refuses odd names, missing, tiny or non-JPEG files, shared targets and half scale entries', () => {
    const m = setup();
    const t = (patch, re) => assert.throws(() => buildData({ ...base(m), ...patch }), re);
    t({ switchMap: { 'orig/a.jpg': '../a.jpg' } }, /odd map file name/);
    t({ switchMap: { '../x.jpg': 'a.jpg' } }, /odd original path/);
    t({ switchMap: { 'o/a.jpg': 'a.jpg', 'o/b.jpg': 'a.jpg' } }, /same map file/);
    t({ switchMap: { 'o/a.jpg': 'nope.jpg' } }, /no map file/);
    writeFileSync(path.join(m, 'tiny.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    t({ switchMap: { 'o/a.jpg': 'tiny.jpg' } }, /too small/);
    writeFileSync(path.join(m, 'png.jpg'), Buffer.alloc(3000, 7));
    t({ switchMap: { 'o/a.jpg': 'png.jpg' } }, /not a JPEG/);
    t({ switchMap: {} }, /no entries/);
    t({ folder: 'elsewhere/x' }, /--folder/);
    t({ scale: { size: [{ name: 'S', from: [1, 2] }] } }, /bad size entry/);
    t({ scale: { grid: [{ name: 'G', from: {}, to: { size: 1 } }] } }, /bad grid entry/);
  });
});

describe(
  'stage 34 in the ARM64 container',
  { skip: process.env.PI_STAGE34_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage34-scenarios.sh', { timeout: 900000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
