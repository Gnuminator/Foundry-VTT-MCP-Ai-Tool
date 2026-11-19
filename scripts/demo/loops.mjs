#!/usr/bin/env node
// Cut the six home page loops (I-192) from recorded takes: a short muted 1280x720 60 fps MP4 and
// a JPEG poster per loop, into docs/images/showcase/. The wiki home page (docs/wiki/index.md)
// names the files; scripts/wiki/stage.mjs checks they exist and fit the size budget.
// Needs ffmpeg and ffprobe on PATH; uses the CPU (libx264), no GPU lock. See DEMO-RECORDINGS.md.
//
//   npm run demo:loops [-- --only roll,undo] [--takes <folder>] [--out <folder>]
//
// Each loop names a take and the steps it covers (steps.json). Record the take on the demo world
// first (`npm run demo:take -- <take>`); the newest folder of that take is used. Record on a world
// with no campaign or book text: the loops are public.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './lib/env.mjs';

/** The six loops. `from` and `to` are step names; the clip is at most `max` seconds. */
export const LOOPS = [
  { id: 'roll', take: 'table-player-attack', from: 'attack', to: 'live-feed', max: 8 },
  { id: 'undo', take: 'damage-undo', from: 'apply', to: 'watch-undo', max: 8 },
  { id: 'handout', take: 'handout-reveal', from: 'reveal', to: 'player-after', max: 8 },
  { id: 'mood', take: 'scene-mood', from: 'switch', to: 'restore', max: 8 },
  { id: 'cards', take: 'tarokka', from: 'deal', to: 'show', max: 8 },
  { id: 'strip', take: 'during-play', from: 'strip', to: 'strip', max: 8 },
];

export const CLIP_BYTES = 2_500_000;
export const POSTER_BYTES = 150_000;

/** Start and length in seconds of a loop in a take's steps. */
export function window(loop, steps) {
  const a = steps.find(s => s.step === loop.from);
  const b = steps.find(s => s.step === loop.to);
  if (!a || !b)
    throw new Error(`${loop.id}: step ${!a ? loop.from : loop.to} is not in steps.json`);
  const start = a.start;
  return { start, length: Math.min(loop.max, Math.max(1, b.end - a.start)) };
}

/** The newest folder `<take>-<date>-<time>` that holds `<take>.mp4`. */
export function newestTake(takesDir, take) {
  const re = new RegExp(`^${take}-\\d{8}-\\d{6}$`);
  const found = readdirSync(takesDir)
    .filter(d => re.test(d) && existsSync(join(takesDir, d, `${take}.mp4`)))
    .sort();
  return found.length ? join(takesDir, found.at(-1)) : null;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error}`);
}

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function main() {
  const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const out = resolve(option('out') ?? join(repo, 'docs', 'images', 'showcase'));
  const takesDir = option('takes') ?? testEnv().takesDir;
  const only = option('only')?.split(',');
  mkdirSync(out, { recursive: true });
  const missing = [];
  for (const loop of LOOPS.filter(l => !only || only.includes(l.id))) {
    const dir = newestTake(takesDir, loop.take);
    if (!dir) {
      missing.push(`${loop.id} (record: npm run demo:take -- ${loop.take})`);
      continue;
    }
    const steps = JSON.parse(readFileSync(join(dir, 'steps.json'), 'utf8'));
    const { start, length } = window(loop, steps);
    const src = join(dir, `${loop.take}.mp4`);
    const clip = join(out, `${loop.id}.mp4`);
    // Raise the CRF until the clip fits the budget.
    for (const crf of [23, 26, 29, 32, 35]) {
      ffmpeg([
        '-ss',
        String(start),
        '-t',
        String(length),
        '-i',
        src,
        '-an',
        '-vf',
        'scale=1280:720:flags=lanczos,fps=60',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        String(crf),
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        clip,
      ]);
      if (statSync(clip).size <= CLIP_BYTES) break;
    }
    const poster = join(out, `${loop.id}.jpg`);
    for (const q of [4, 8, 12, 18]) {
      ffmpeg([
        '-ss',
        String(start + length / 2),
        '-i',
        src,
        '-frames:v',
        '1',
        '-vf',
        'scale=1280:720:flags=lanczos',
        '-q:v',
        String(q),
        poster,
      ]);
      if (statSync(poster).size <= POSTER_BYTES) break;
    }
    console.log(`${loop.id}: ${statSync(clip).size} B clip, ${statSync(poster).size} B poster`);
  }
  if (missing.length) {
    console.error(`No take for: ${missing.join('; ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
