#!/usr/bin/env node
// One command from takes plus narration to finished videos (see docs/dev/DEMO-RECORDINGS.md,
// "Compose finished videos"). Needs ffmpeg and ffprobe on PATH.
//
//   node scripts/demo/compose.mjs <manifest.json> [--cut master,day-one] [--draft-only | --final-only]
//                                 [--res 1080|1440|2160] [--out <dir>] [--cpu]
//
// The manifest names the chapters (a take folder or a video + steps.json, and optionally the
// narration tool's output: <name>.wav and <name>.timing.json) and the cuts (lists of chapters).
// Per cut it writes, into the output folder (default: next to the manifest, never the repo):
//   draft/<cut>.draft.mp4        540p60 review cut, made first
//   stills/<chapter>-<step>.png  one still at the start of every step, made with the draft
//   <cut>.mp4                    the 1440p60 cut: narration, ducked music, -16 LUFS, xfaded chapters
//   <cut>.burned.mp4             the same with the captions burned in (second export)
//   <cut>.srt, <cut>.vtt, <cut>.chapters.txt
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cuesFor, toAss, toSrt, toVtt } from './lib/captions.mjs';
import {
  FPS,
  assembleGraph,
  audioGraph,
  cardFilter,
  chapterGraph,
  chapterMetadata,
  mapNarration,
  planStep,
  timeline,
  youtubeChapters,
} from './lib/compose-plan.mjs';

/** ffmpeg filter-argument path: forward slashes, the drive colon escaped. */
export const esc = p => p.replaceAll('\\', '/').replace(':', '\\:');

/** Find the recording in a take folder: the one .mp4 next to steps.json (export/ is skipped). */
function takeFiles(dir) {
  const mp4 = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp4'));
  if (mp4.length !== 1)
    throw new Error(`${dir}: expected one .mp4 next to steps.json, found ${mp4.length}`);
  return { video: join(dir, mp4[0]), steps: join(dir, 'steps.json') };
}

/**
 * Read and resolve a manifest (paths relative to its folder). Chapter: {id, title, take | video +
 * steps, narration?, map?, cursor?}; cuts: {name: [chapter ids]}; clips: true adds one cut per chapter.
 */
export function resolveManifest(file) {
  const base = dirname(resolve(file));
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const at = p => (p ? resolve(base, p) : null);
  const chapters = (m.chapters ?? []).map(c => {
    const t = c.take ? takeFiles(at(c.take)) : { video: at(c.video), steps: at(c.steps) };
    const nar = c.narration ? at(c.narration) : null;
    return {
      id: String(c.id),
      title: c.title ?? String(c.id),
      ...t,
      map: c.map ?? {},
      cursor: !!c.cursor,
      narration: nar ? { wav: `${nar}.wav`, timing: `${nar}.timing.json` } : null,
    };
  });
  const ids = new Set(chapters.map(c => c.id));
  if (ids.size !== chapters.length) throw new Error('manifest: chapter ids must be unique');
  const cuts = Object.entries(m.cuts ?? {}).map(([name, list]) => ({
    name,
    ids: list.map(String),
  }));
  if (m.clips) for (const c of chapters) cuts.push({ name: `clip-${c.id}`, ids: [c.id] });
  for (const cut of cuts)
    for (const id of cut.ids)
      if (!ids.has(id)) throw new Error(`manifest: cut "${cut.name}" names unknown chapter ${id}`);
  return {
    brand: m.brand ?? '',
    fontsDir: at(m.fontsDir),
    music: m.music?.file ? { file: at(m.music.file), gainDb: m.music.gainDb ?? -14 } : null,
    chapters,
    cuts,
  };
}

/** Output size for a mode: the 540p draft or a --res of 1080, 1440 or 2160. */
export const sizeFor = (draft, res) => {
  if (draft) return { W: 960, H: 540 };
  if (![1080, 1440, 2160].includes(res))
    throw new Error(`--res must be 1080, 1440 or 2160, got ${res}`);
  return { W: (res * 16) / 9, H: res };
};

function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });
  if (r.status !== 0)
    throw new Error(
      `${cmd} failed (${r.status}): ${(r.stderr || r.error?.message || '').slice(-1500)}`
    );
  return r.stdout;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(`--${n}`);
  const opt = n => (flag(n) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const manifestFile = argv.find(
    a => !a.startsWith('--') && a !== opt('cut') && a !== opt('res') && a !== opt('out')
  );
  if (!manifestFile)
    throw new Error(
      'usage: compose.mjs <manifest.json> [--cut a,b] [--draft-only|--final-only] [--res 1440] [--out dir] [--cpu]'
    );
  const man = resolveManifest(manifestFile);
  const outDir = resolve(opt('out') ?? join(dirname(resolve(manifestFile)), 'compose-out'));
  const res = Number(opt('res')) || 1440;
  const wanted = opt('cut')?.split(',');
  const cuts = wanted ? man.cuts.filter(c => wanted.includes(c.name)) : man.cuts;
  if (!cuts.length) throw new Error('no cut to build (check the manifest "cuts" or --cut)');
  const ctx = { man, outDir, res, cpu: flag('cpu') };
  mkdirSync(outDir, { recursive: true });
  if (!flag('final-only')) pass(ctx, cuts, true);
  if (!flag('draft-only')) pass(ctx, cuts, false);
}

function nvencWorks() {
  const r = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=s=256x256:d=0.1',
    '-c:v',
    'h264_nvenc',
    '-f',
    'null',
    '-',
  ]);
  return r.status === 0;
}

/** One pass: every needed chapter at this size, then every cut. The draft pass also makes the stills. */
function pass(ctx, cuts, draft) {
  const { man, outDir } = ctx;
  const { W, H } = sizeFor(draft, ctx.res);
  const mode = draft ? 'draft' : String(H);
  const work = join(outDir, 'work', mode);
  mkdirSync(work, { recursive: true });
  const nv = !draft && !ctx.cpu && nvencWorks();
  const inter =
    draft || !nv
      ? ['-c:v', 'libx264', '-preset', draft ? 'ultrafast' : 'fast', '-crf', '14']
      : ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '14'];
  const fin = draft
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22']
    : nv
      ? ['-c:v', 'h264_nvenc', '-preset', 'p6', '-cq', '21']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
  const ff = (args, cwd = work) =>
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd });
  const ids = [...new Set(cuts.flatMap(c => c.ids))];
  console.log(
    `\n== ${draft ? 'Draft 540p' : `Final ${H}p`}: ${ids.length} chapters, ${cuts.length} cuts${draft || nv ? '' : ' (CPU encode)'}`
  );

  const built = new Map();
  for (const id of ids)
    built.set(
      id,
      buildChapter(
        man.chapters.find(c => c.id === id),
        { man, W, H, draft, work, inter, ff }
      )
    );
  if (draft) makeStills(built, outDir, ff);

  for (const cut of cuts) {
    const parts = cut.ids.map(id => built.get(id));
    composeCut({ cut, parts, man, outDir, work, W, H, draft, fin, ff });
  }
}

function glitchRanges(file, work, ff) {
  const st = statSync(file);
  const cf = join(work, `${basename(file)}.glitch.json`);
  if (existsSync(cf)) {
    const c = JSON.parse(readFileSync(cf, 'utf8'));
    if (c.size === st.size && c.mtime === st.mtimeMs) return c.ranges;
  }
  // The recorder sometimes draws the page in the top-left quarter and the rest flat grey
  // (Playwright's page.screenshot with scale "css" while OBS records). Found by the bottom-right
  // quadrant being flat grey (luma 60); each run is widened by one frame, and the frame before
  // it is shown instead.
  ff([
    '-i',
    file,
    '-vf',
    'scale=384:216:flags=area,crop=192:108:192:108,signalstats,metadata=mode=print:file=glitch.txt',
    '-f',
    'null',
    '-',
  ]);
  const flat = [];
  for (const f of ('\n' + readFileSync(join(work, 'glitch.txt'), 'utf8'))
    .split('\nframe:')
    .slice(1)) {
    const g = k => Number(new RegExp('signalstats\\.' + k + '=([\\d.]+)').exec(f)?.[1]);
    const n = /^(\d+)\s/.exec(f)?.[1];
    if (n !== undefined && g('YMAX') - g('YMIN') <= 8 && Math.abs(g('YAVG') - 60) <= 4)
      flat.push(Number(n));
  }
  const ranges = [];
  for (const n of flat) {
    const last = ranges.at(-1);
    if (last && n - last[1] <= 2) last[1] = n;
    else ranges.push([n, n]);
  }
  const wide = ranges.map(([a, b]) => [Math.max(0, a - 1), b + 1]);
  writeFileSync(cf, JSON.stringify({ size: st.size, mtime: st.mtimeMs, ranges: wide }));
  return wide;
}

const probeFrames = file =>
  Number(
    run('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_read_frames',
      '-of',
      'csv=p=0',
      file,
    ]).trim()
  );

function buildChapter(ch, { man, W, H, draft, work, inter, ff }) {
  if (!existsSync(ch.video) || !existsSync(ch.steps))
    throw new Error(`chapter ${ch.id}: missing ${ch.video} or ${ch.steps}`);
  const steps = JSON.parse(readFileSync(ch.steps, 'utf8'));
  const probe = JSON.parse(
    run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_frames,duration',
      '-of',
      'json',
      ch.video,
    ])
  ).streams[0];
  const rawFrames = Number(probe.nb_frames) || Math.floor(Number(probe.duration) * FPS);

  let narr = { byStep: {}, unmatchedHeadings: [] };
  if (ch.narration) {
    const timing = JSON.parse(readFileSync(ch.narration.timing, 'utf8'));
    narr = mapNarration(steps, timing.sentences ?? [], ch.map);
    if (narr.unmatchedHeadings.length)
      console.warn(
        `  chapter ${ch.id}: narration headings with no step: ${narr.unmatchedHeadings.join(', ')}`
      );
  }
  const plans = steps.map((st, i) =>
    planStep({
      st,
      index: i,
      next: steps[i + 1] ?? null,
      rawFrames,
      narrationS: narr.byStep[st.step] ? narr.byStep[st.step].to - narr.byStep[st.step].from : 0,
    })
  );

  const fontsOk =
    man.fontsDir &&
    existsSync(join(man.fontsDir, 'space-grotesk-600.ttf')) &&
    existsSync(join(man.fontsDir, 'space-grotesk-500.ttf'));
  const segoe = 'C:/Windows/Fonts/segoeui.ttf'.replace(':', '\\:');
  const titleFile = join(work, `title-${ch.id}.txt`);
  writeFileSync(titleFile, ch.title);
  const card = cardFilter({
    W,
    H,
    titleFile: esc(titleFile),
    brand: man.brand.replaceAll("'", ''),
    label: 'card',
    fontBold: fontsOk ? esc(join(man.fontsDir, 'space-grotesk-600.ttf')) : segoe,
    fontMed: fontsOk ? esc(join(man.fontsDir, 'space-grotesk-500.ttf')) : segoe,
  });
  const glitches = glitchRanges(ch.video, work, ff);
  const { graph, bodyFrames, offset } = chapterGraph({
    plans,
    steps,
    glitches,
    card,
    W,
    H,
    draft,
    cursor: ch.cursor,
  });

  const file = join(work, `ch-${ch.id}.mp4`);
  const key = createHash('sha1')
    .update(graph)
    .update(String(statSync(ch.video).mtimeMs))
    .update(String(statSync(ch.video).size))
    .update(inter.join())
    .digest('hex');
  const keyFile = `${file}.key`;
  let frames;
  if (existsSync(file) && existsSync(keyFile) && readFileSync(keyFile, 'utf8').startsWith(key)) {
    frames = Number(readFileSync(keyFile, 'utf8').split(' ')[1]);
    console.log(`${ch.id} ${ch.title}: cached`);
  } else {
    const gfile = join(work, `graph-${ch.id}.txt`);
    writeFileSync(gfile, graph);
    const t0 = Date.now();
    ff([
      '-i',
      ch.video,
      '-/filter_complex',
      gfile,
      '-map',
      '[out]',
      ...inter,
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-an',
      file,
    ]);
    frames = probeFrames(file);
    const expected = Math.round(offset * FPS) + bodyFrames;
    console.log(
      `${ch.id} ${ch.title}: ${plans.length} steps, ${(frames / FPS).toFixed(1)} s${frames === expected ? '' : ` (EXPECTED ${expected} frames, got ${frames})`}, ${glitches.length} glitch runs fixed, ${((Date.now() - t0) / 1000).toFixed(0)} s`
    );
    writeFileSync(keyFile, `${key} ${frames}`);
  }
  plans.forEach((p, i) => {
    const n = narr.byStep[steps[i].step];
    console.log(
      `   ${steps[i].step.padEnd(16)} have ${p.have.toFixed(1).padStart(5)} need ${p.need.toFixed(1).padStart(5)} -> ${p.outLen.toFixed(1).padStart(5)} s ${p.mode}${p.hold > 0 ? ` hold ${p.hold.toFixed(1)}` : ''}${p.focus ? ' zoom' : ''}${n ? '' : ' (no narration)'}`
    );
  });
  return { ch, file, frames, steps, plans, narr };
}

function makeStills(built, outDir, ff) {
  const dir = join(outDir, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const b of built.values()) {
    const tl = timeline([{ frames: b.frames, steps: b.plans.map(p => ({ len: p.outLen })) }]);
    b.steps.forEach((s, i) => {
      const t = tl.stepInfo[0][i].start + 0.15;
      ff(
        [
          '-ss',
          t.toFixed(3),
          '-i',
          b.file,
          '-frames:v',
          '1',
          '-vf',
          'scale=960:-2:flags=lanczos',
          join(dir, `${b.ch.id}-${s.step}.png`),
        ],
        outDir
      );
    });
  }
  console.log(`Stills: ${dir}`);
}

function composeCut({ cut, parts, man, outDir, work, W, H, draft, fin, ff }) {
  const tl = timeline(
    parts.map(b => ({ frames: b.frames, steps: b.plans.map(p => ({ len: p.outLen })) }))
  );
  const { graph: vg, total } = assembleGraph(parts.map(b => b.frames));

  // Narration pieces on the cut's clock, and the caption cues from the real sentence times.
  const inputs = parts.map(b => ['-i', b.file]).flat();
  const nChap = parts.length;
  inputs.push('-i', join(work, `${cut.name}.chapters.ffmeta`));
  let next = nChap + 1;
  const wavIndex = new Map();
  const clips = [];
  const cues = [];
  parts.forEach((b, j) => {
    for (const [i, st] of b.steps.entries()) {
      const n = b.narr.byStep[st.step];
      if (!n) continue;
      if (!wavIndex.has(b.ch.narration.wav)) {
        wavIndex.set(b.ch.narration.wav, next++);
        inputs.push('-i', b.ch.narration.wav);
      }
      const at = tl.stepInfo[j][i].voiceAt;
      clips.push({ input: wavIndex.get(b.ch.narration.wav), from: n.from, to: n.to + 0.05, at });
      for (const s of n.sentences)
        cues.push(...cuesFor(s.shown, at + (s.start - n.from), at + (s.end - n.from)));
    }
  });
  let music = null;
  if (man.music) {
    inputs.push('-i', man.music.file);
    music = { input: next++, gainDb: man.music.gainDb };
  }
  const marks = parts.map((b, j) => ({ at: tl.starts[j], title: b.ch.title }));
  writeFileSync(join(work, `${cut.name}.chapters.ffmeta`), chapterMetadata(marks, total));
  const ag = audioGraph({ clips, music, total });
  const gfile = join(work, `graph-${cut.name}.txt`);
  writeFileSync(gfile, ag ? `${vg};\n${ag}` : vg);

  const final = draft
    ? join(outDir, 'draft', `${cut.name}.draft.mp4`)
    : join(outDir, `${cut.name}.mp4`);
  mkdirSync(dirname(final), { recursive: true });
  const audioArgs = ag
    ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', draft ? '128k' : '192k', '-ar', '48000']
    : ['-an'];
  ff([
    ...inputs,
    '-/filter_complex',
    gfile,
    '-map',
    '[out]',
    ...audioArgs,
    '-map_metadata',
    String(nChap),
    '-map_chapters',
    String(nChap),
    ...fin,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FPS),
    '-movflags',
    '+faststart',
    final,
  ]);
  console.log(
    `${final}: ${total.toFixed(1)} s, ${clips.length} narration pieces, ${cues.length} captions`
  );

  if (draft) return;
  writeFileSync(join(outDir, `${cut.name}.srt`), toSrt(cues));
  writeFileSync(join(outDir, `${cut.name}.vtt`), toVtt(cues));
  writeFileSync(join(outDir, `${cut.name}.chapters.txt`), youtubeChapters(marks));
  if (!cues.length) return;
  const fontsOk = man.fontsDir && existsSync(man.fontsDir);
  writeFileSync(
    join(work, `${cut.name}.ass`),
    toAss(cues, { W, H, font: fontsOk ? 'Space Grotesk Light Medium' : 'Segoe UI' })
  );
  const burned = join(outDir, `${cut.name}.burned.mp4`);
  ff([
    '-i',
    final,
    '-vf',
    `subtitles=${cut.name}.ass${fontsOk ? `:fontsdir='${esc(man.fontsDir)}'` : ''}`,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    ...fin,
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(FPS),
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    burned,
  ]);
  console.log(`${burned}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`compose: ${e.message}`);
    process.exit(1);
  }
}
