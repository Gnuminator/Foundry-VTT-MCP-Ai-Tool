#!/usr/bin/env node
// Export a recorded take (I-082): a 1080p copy, a short clip for a README, and YouTube
// chapters from steps.json. Needs ffmpeg and ffprobe on PATH. See docs/dev/DEMO-RECORDINGS.md.
//
//   npm run demo:export -- <take name or take folder> [options]
//
//   <take name>            the newest folder of that take in C:\FoundryTest\demo\takes
//   --clip <step>[..<step>] the clip covers these steps (default: the whole take)
//   --from <s> --to <s>    or these seconds of the video
//   --max-mb <n>           clip size limit (default 10, GitHub's limit for a README video)
//   --no-copy              skip the 1080p copy
//
// Writes into <take folder>/export/: <take>-1080p.mp4, <take>-clip.mp4, chapters.txt.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './lib/env.mjs';

/** "m:ss" (or "h:mm:ss") for YouTube chapters. */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * YouTube chapters from steps.json. YouTube wants the first chapter at 0:00, at least three
 * chapters and each one 10 seconds or longer, so shorter steps are merged into the one
 * before. Returns the lines and the rules the result still breaks (empty when fine).
 * @param {{step: string, title: string, start: number, end: number}[]} steps
 * @param {number} duration  video length in seconds
 */
export function chapters(steps, duration) {
  const merged = [];
  for (const s of steps) {
    const last = merged.at(-1);
    if (last && s.start - last.start < 10) last.titles.push(s.title);
    else merged.push({ start: merged.length ? s.start : 0, titles: [s.title] });
  }
  // A short last chapter joins the one before.
  while (merged.length > 1 && duration - merged.at(-1).start < 10) {
    const last = merged.pop();
    merged.at(-1).titles.push(...last.titles);
  }
  const lines = merged.map(c => `${formatTime(c.start)} ${c.titles.join('; ')}`);
  const problems = [];
  if (merged.length < 3)
    problems.push(`only ${merged.length} chapter(s); YouTube needs 3 or more of 10 s each`);
  return { lines, problems };
}

/**
 * Video bitrate (bits per second) that keeps a clip under maxBytes, capped. 15% headroom:
 * a two-pass encode of a mostly still UI overshot its target by about 13% in a test.
 */
export function clipBitrate(durationSec, maxBytes, capBps = 12_000_000) {
  return Math.min(capBps, Math.floor((maxBytes * 8 * 0.85) / durationSec));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} not found on PATH (winget install Gyan.FFmpeg).`);
  if (r.status !== 0)
    throw new Error(`${cmd} failed: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
  return r.stdout;
}

function duration(file) {
  return Number(
    run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]).trim()
  );
}

function parseArgs(argv) {
  const o = { target: '', clip: '', from: NaN, to: NaN, maxMb: 10, copy: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clip') o.clip = argv[++i];
    else if (a === '--from') o.from = Number(argv[++i]);
    else if (a === '--to') o.to = Number(argv[++i]);
    else if (a === '--max-mb') o.maxMb = Number(argv[++i]);
    else if (a === '--no-copy') o.copy = false;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else o.target = a;
  }
  if (!o.target)
    throw new Error(
      'Usage: npm run demo:export -- <take name or folder> [--clip a..b] [--from s --to s] [--max-mb 10] [--no-copy]'
    );
  return o;
}

/** A take folder: the path itself, or the newest "<name>-<date>-<time>" folder of a take. */
function takeFolder(target) {
  if (existsSync(join(target, 'take.json'))) return target;
  const { takesDir } = testEnv();
  const found = existsSync(takesDir)
    ? readdirSync(takesDir)
        .filter(d => d.startsWith(`${target}-`) && existsSync(join(takesDir, d, 'take.json')))
        .sort()
    : [];
  if (!found.length) throw new Error(`No recorded take "${target}" in ${takesDir}.`);
  return join(takesDir, found.at(-1));
}

function clipRange(o, steps, total) {
  if (!Number.isNaN(o.from) || !Number.isNaN(o.to)) {
    return { from: Number.isNaN(o.from) ? 0 : o.from, to: Number.isNaN(o.to) ? total : o.to };
  }
  if (!o.clip) return { from: 0, to: total };
  const [a, b = a] = o.clip.split('..');
  const first = steps.find(s => s.step === a);
  const last = steps.find(s => s.step === b);
  if (!first || !last) throw new Error(`--clip: steps are ${steps.map(s => s.step).join(', ')}.`);
  // Half a second either side, so a click is not cut off.
  return { from: Math.max(0, first.start - 0.5), to: Math.min(total, last.end + 0.5) };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const dir = takeFolder(o.target);
  const take = JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8'));
  if (!take.video || !existsSync(take.video))
    throw new Error(`${dir} has no video (recorded with --no-record?).`);
  const steps = JSON.parse(readFileSync(join(dir, 'steps.json'), 'utf8'));
  const name = basename(take.video, '.mp4');
  const out = join(dir, 'export');
  mkdirSync(out, { recursive: true });
  const total = duration(take.video);

  if (o.copy && take.res !== 1080) {
    const file = join(out, `${name}-1080p.mp4`);
    run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-i',
      take.video,
      '-vf',
      'scale=1920:1080:flags=lanczos',
      '-r',
      '60',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      file,
    ]);
    console.log(`1080p copy: ${file}`);
  }

  // The clip: 1080p60, two-pass to a bitrate that keeps it under the size limit.
  const { from, to } = clipRange(o, steps, total);
  const length = to - from;
  if (length <= 0) throw new Error(`Empty clip (${from} s to ${to} s).`);
  // Decimal megabytes: the stricter reading of "10 MB".
  const maxBytes = o.maxMb * 1_000_000;
  const bitrate = clipBitrate(length, maxBytes);
  const clip = join(out, `${name}-clip.mp4`);
  const passlog = join(out, 'ffmpeg2pass');
  const common = [
    '-v',
    'error',
    '-y',
    '-ss',
    String(from),
    '-t',
    String(length),
    '-i',
    take.video,
    '-vf',
    'scale=1920:1080:flags=lanczos',
    '-r',
    '60',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-b:v',
    String(bitrate),
    '-maxrate',
    String(Math.floor(bitrate * 1.5)),
    '-bufsize',
    String(bitrate * 2),
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-passlogfile',
    passlog,
  ];
  run('ffmpeg', [
    ...common,
    '-pass',
    '1',
    '-f',
    'mp4',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  ]);
  run('ffmpeg', [...common, '-pass', '2', '-movflags', '+faststart', clip]);
  for (const f of readdirSync(out).filter(f => f.startsWith('ffmpeg2pass')))
    rmSync(join(out, f), { force: true });
  const mb = statSync(clip).size / 1_000_000;
  console.log(
    `Clip: ${clip} (${from.toFixed(1)} s to ${to.toFixed(1)} s, ${mb.toFixed(1)} MB${mb > o.maxMb ? `, OVER ${o.maxMb} MB` : ''})`
  );

  const ch = chapters(steps, total);
  writeFileSync(join(out, 'chapters.txt'), `${ch.lines.join('\n')}\n`);
  console.log(`Chapters: ${join(out, 'chapters.txt')}`);
  for (const p of ch.problems)
    console.log(`  note: ${p} (fine for a short clip; a full video needs them).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(String(err.message || err));
    process.exitCode = 1;
  }
}
