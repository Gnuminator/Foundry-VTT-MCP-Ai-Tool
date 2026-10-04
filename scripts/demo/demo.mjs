#!/usr/bin/env node
// Repeatable demo takes on the local test server (I-082). See docs/dev/DEMO-RECORDINGS.md.
//
//   npm run demo:obs-setup [-- --res 2160]     set up OBS once (WebSocket, profile, scenes)
//   npm run demo:take -- <take> [options]      record one take from scripts/demo/takes/<take>.mjs
//   npm run demo:take -- <path/to/take.mjs>    ... or a take kept outside the repo
//
// Take options:
//   --res 1080|1440|2160   output size, always 60 fps MP4 (default 2160)
//   --no-reset             skip reset-demo-world.ps1 (the world must already run)
//   --no-record            drive the take without OBS (rehearsal; still saves screenshots)
//   --keep-open            leave the browser windows open afterwards
//   --world <id>           another demo world (ai-tool-demo-<name>); default ai-tool-demo
//
// Test server only: the world must be a demo world; the live bridge ports 31414-31416
// are refused.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEMO_DIR, REPO_ROOT, RESOLUTIONS, demoWorld, testEnv } from './lib/env.mjs';
import { ensureObs } from './lib/obs-setup.mjs';
import { Take } from './lib/take.mjs';

function parseArgs(argv) {
  const opts = { _: [], res: 2160, reset: true, record: true, keepOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--res') opts.res = Number(argv[++i]);
    else if (a === '--no-reset') opts.reset = false;
    else if (a === '--no-record') opts.record = false;
    else if (a === '--keep-open') opts.keepOpen = true;
    else if (a === '--world') process.env.DEMO_WORLD_ID = argv[++i] ?? '';
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts._.push(a);
  }
  demoWorld(); // checks --world
  if (!RESOLUTIONS[opts.res])
    throw new Error(`--res must be 1080, 1440 or 2160 (got ${opts.res}).`);
  return opts;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function cmdObsSetup(opts) {
  const env = testEnv();
  const obs = await ensureObs({ res: opts.res, recordDir: env.takesDir });
  try {
    const { obsVersion } = await obs.call('GetVersion');
    console.log(
      `OBS ${obsVersion}: profile, scenes and ${opts.res}p60 Hybrid MP4 output are set up.`
    );
  } finally {
    obs.close();
  }
}

function resetWorld() {
  const script = join(REPO_ROOT, 'scripts', 'test-env', 'reset-demo-world.ps1');
  const r = spawnSync('pwsh', ['-NoProfile', '-File', script, '-Start', '-World', demoWorld()], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`reset-demo-world.ps1 failed (exit ${r.status}).`);
}

/** Resolution and frame rate of a video, if ffprobe is on PATH. */
function probe(file) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,width,height,avg_frame_rate',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' }
  );
  return r.status === 0 ? r.stdout.trim() : '(ffprobe not available)';
}

async function cmdTake(opts) {
  const arg = opts._[1];
  if (!arg)
    throw new Error('Usage: npm run demo:take -- <take> [--res 2160] [--no-reset] [--no-record]');
  // A name is a take in scripts/demo/takes; a path to a .mjs file is a take kept elsewhere.
  const file = arg.endsWith('.mjs') ? resolve(arg) : join(DEMO_DIR, 'takes', `${arg}.mjs`);
  const name = basename(file, '.mjs');
  if (!existsSync(file)) throw new Error(`No take ${file}`);
  const mod = await import(pathToFileURL(file).href);
  const env = testEnv();
  const outDir = join(env.takesDir, `${name}-${stamp()}`);
  mkdirSync(outDir, { recursive: true });

  if (opts.reset) resetWorld();
  const obs = opts.record ? await ensureObs({ res: opts.res, recordDir: outDir }) : undefined;
  const take = new Take({ name, outDir, res: opts.res, env, obs });
  take.lib = await import('./lib/index.mjs');
  const report = {
    name,
    title: mod.meta?.title ?? name,
    res: opts.res,
    fps: 60,
    outDir,
    video: null,
    error: null,
  };
  let recording = false;
  try {
    console.log(`Take "${report.title}" at ${opts.res}p: setting up windows...`);
    await mod.setup(take);
    if (obs) {
      await obs.startRecord(outDir);
      recording = true;
    }
    take.markStart();
    await take.pause(1000);
    await mod.run(take);
    await take.pause(1000);
  } catch (err) {
    report.error = String(err.stack || err);
    console.error(`Take failed: ${err.message || err}`);
  } finally {
    if (recording) {
      const raw = await obs.stopRecord();
      const video = join(outDir, `${name}${extname(raw) || '.mp4'}`);
      renameSync(raw, video);
      report.video = video;
      report.probe = probe(video);
    }
    obs?.close();
    report.steps = take.steps;
    report.shots = take.shots;
    report.consoleErrors = take.errors();
    writeFileSync(
      join(outDir, 'steps.json'),
      `${JSON.stringify(
        take.steps.map(({ step, title, start, end }) => ({ step, title, start, end })),
        null,
        2
      )}\n`
    );
    writeFileSync(join(outDir, 'take.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!opts.keepOpen) await take.closeAll();
  }
  console.log(`\nTake folder: ${outDir}`);
  if (report.video) console.log(`Video: ${report.video} (${report.probe})`);
  console.log(`Steps: ${take.steps.length}, screenshots: ${take.shots.length}`);
  const errorCount = Object.values(report.consoleErrors).reduce((n, list) => n + list.length, 0);
  if (errorCount) console.log(`Console errors: ${errorCount} (see take.json)`);
  if (report.error) process.exitCode = 1;
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0];
try {
  if (cmd === 'obs-setup') await cmdObsSetup(opts);
  else if (cmd === 'take') await cmdTake(opts);
  else {
    console.log(
      'Usage: node scripts/demo/demo.mjs obs-setup | take <name|path.mjs> [--res 2160] [--no-reset] [--no-record] [--keep-open] [--world <id>]'
    );
    process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  console.error(String(err.message || err));
  process.exitCode = 1;
}
// Browser and socket handles can outlive a failed take; do not hang on them.
process.exit();
