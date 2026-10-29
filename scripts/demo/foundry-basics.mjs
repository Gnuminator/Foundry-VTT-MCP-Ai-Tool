#!/usr/bin/env node
// Re-runnable capture of the pictures in docs/foundry/ (screenshots and short MP4 loops).
// Foundry's own UI changes between versions; run this again and commit the new files.
//
//   FOUNDRY_TEST_SERVER=B node scripts/demo/foundry-basics.mjs [options]
//
//   --only <a,b>   only these pictures (names as in SHOTS and LOOPS below)
//   --shots        only the screenshots (headless Edge, no screen needed)
//   --loops        only the MP4 loops (a visible fullscreen Edge window, recorded with ffmpeg
//                  from the top-left of the primary monitor; it takes the screen for a few
//                  seconds per loop, see scripts/demo/lib/ffmpeg-recorder.mjs)
//   --list         print the picture names and stop
//
// Needs a test server (take its lock first: scripts/test-env/lock.ps1) running the demo world
// ai-tool-demo, copied from server A (invented content only; no campaign or book text) and
// signed in as its passwordless GM. Writes docs/images/foundry/<name>.png and <name>.mp4.
// Each loop also gets <name>.png as its poster. MP4s are re-encoded small (muted, 60 fps,
// 1080p) and the script fails when one is over 2 MB.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { openWindow } from './lib/browser.mjs';
import { REPO_ROOT, testEnv } from './lib/env.mjs';
import { FfmpegRecorder } from './lib/ffmpeg-recorder.mjs';
import { joinFoundry, unpause } from './lib/foundry.mjs';
import { LOOPS, SHOTS } from './lib/foundry-basics-shots.mjs';

const OUT = join(REPO_ROOT, 'docs', 'images', 'foundry');
const WORLD = 'ai-tool-demo';
const GM = 'GM';
const MAX_MB = 2;

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const wanted = name => !only || only.includes(name);

if (flag('--list')) {
  console.log('shots:', Object.keys(SHOTS).join(', '));
  console.log('loops:', Object.keys(LOOPS).join(', '));
  process.exit(0);
}

const env = testEnv();
mkdirSync(OUT, { recursive: true });

/** Hide toasts and make the page calm: no notifications, game unpaused, windows closed. */
async function settle(page) {
  await page.addStyleTag({
    content: '#notifications, .notification, #pause { display: none !important; }',
  });
  await unpause(page);
  await page.evaluate(async () => {
    globalThis.ui.notifications.clear();
    // An empty chat log, so no leftovers from an earlier run show in a picture.
    await globalThis.ChatMessage.deleteDocuments(globalThis.game.messages.map(m => m.id));
    for (const app of [...globalThis.foundry.applications.instances.values()]) {
      if (app.options?.window?.frame !== false && app.close && app.hasFrame) await app.close();
    }
  });
}

async function runShots() {
  const names = Object.keys(SHOTS).filter(wanted);
  if (!names.length) return;
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    for (const name of names) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      const shot = SHOTS[name];
      try {
        if (shot.beforeJoin) {
          await shot.run({ page, env, out: file => join(OUT, file) });
        } else {
          await joinFoundry(page, { foundryUrl: env.foundryUrl, world: WORLD, user: GM });
          await settle(page);
          await page.waitForTimeout(1500);
          await shot.run({ page, env, out: file => join(OUT, file) });
        }
        console.log(`shot ${name}.png`);
      } catch (err) {
        console.error(`FAILED ${name}: ${err.message}`);
        process.exitCode = 1;
        await page.screenshot({ path: join(OUT, `_failed-${name}.png`) }).catch(() => {});
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

/** Re-encode a near-lossless capture into a small muted loop. */
function encode(raw, file) {
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      raw,
      '-an',
      '-vf',
      'fps=60,scale=1920:1080:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '30',
      '-movflags',
      '+faststart',
      file,
    ],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr}`);
  const mb = statSync(file).size / 1024 / 1024;
  if (mb > MAX_MB) throw new Error(`${file} is ${mb.toFixed(2)} MB, over ${MAX_MB} MB`);
  return mb;
}

async function runLoops() {
  const names = Object.keys(LOOPS).filter(wanted);
  if (!names.length) return;
  const rawDir = join(env.demoRoot, 'foundry-basics-raw');
  mkdirSync(rawDir, { recursive: true });
  const win = await openWindow({
    title: 'Foundry basics',
    url: env.foundryUrl,
    css: { width: 1920, height: 1080 },
    fullscreen: true,
    cursor: true,
  });
  try {
    await joinFoundry(win.page, { foundryUrl: env.foundryUrl, world: WORLD, user: GM });
    await settle(win.page);
    for (const name of names) {
      const loop = LOOPS[name];
      const dir = join(rawDir, name);
      rmSync(dir, { recursive: true, force: true });
      const recorder = new FfmpegRecorder({ width: 1920, height: 1080 });
      try {
        await loop.setup?.({ page: win.page });
        await win.page.waitForTimeout(1000);
        await win.page.screenshot({ path: join(OUT, `${name}.png`) });
        await recorder.startRecord(dir);
        await loop.run({ page: win.page });
        const raw = await recorder.stopRecord();
        const mb = encode(raw, join(OUT, `${name}.mp4`));
        console.log(`loop ${name}.mp4 (${mb.toFixed(2)} MB)`);
      } catch (err) {
        recorder.close();
        console.error(`FAILED ${name}: ${err.message}`);
        process.exitCode = 1;
      } finally {
        await loop.cleanup?.({ page: win.page }).catch(() => {});
        await settle(win.page).catch(() => {});
      }
    }
  } finally {
    await win.close();
  }
}

if (!flag('--loops')) await runShots();
if (!flag('--shots')) await runLoops();
