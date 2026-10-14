// Pure planning for the video compose command (scripts/demo/compose.mjs): step timing from the
// narration, speed ramps and holds, zoom / cursor / click ring expressions, the ffmpeg filter
// graphs and the global timeline. No ffmpeg or file access here, so the numbers can be tested.
//
// Ported from the GM video's stitch.mjs (kept outside the repo with the takes); the narration
// now sets each step's length from the real audio (the voice tool's timing.json) instead of a
// words-per-second guess.

export const FPS = 60;

export const BREATH = 1.0; // seconds of air around a narration line (lead-in plus tail)
export const LEAD_IN = 0.2; // the narration for a step starts this long after the step does
export const CARD = 1.5; // chapter card, seconds
export const XFADE = 0.4; // card <-> clip and chapter <-> chapter cross fade, seconds
export const MAX_SLOW = 1.3; // slow a step down at most this much before holding
export const SPEEDUP = 4; // dead time plays at this speed
export const DEAD = 1.5; // a step longer than its narration by more than this gets dead time cut
export const KEEP = 0.6; // keep this much at 1x at both ends of a step
export const RAMP = 0.3; // raw seconds at 2x on each side of the fast part

export const ZOOM = 1.4; // default focus zoom, clamped to ZOOM_MIN..ZOOM_MAX
export const ZOOM_MIN = 1.3;
export const ZOOM_MAX = 1.6;
export const EASE = 0.5; // zoom ease in and out, seconds
export const LEAD = 0.3; // the ease in starts this long before focus.at
export const DRIFT = 0.03; // gentle push-in during a held last frame (fraction)

export const RING_SECONDS = 0.6; // the click ring grows and fades over this long
export const CURSOR_TRAVEL = 0.5; // the drawn cursor eases to the click point over this long
export const TARGET_LUFS = -16;

const r3 = v => Math.round(v * 1000) / 1000;

/** Lower-case words joined by dashes: "Pre-flight runs!" -> "pre-flight-runs". */
export const slug = s =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Tie narration sentences (timing.json `sentences`) to steps (steps.json). A sentence belongs to
 * a step when its `heading` is that step's name or title (compared as slugs); `override` maps a
 * step name to [firstIndex, lastIndex] of sentences and wins. Steps without narration are left
 * out. Returns {byStep: {step: {from, to, sentences}}, unmatchedHeadings: string[]}.
 */
export function mapNarration(steps, sentences, override = {}) {
  const byStep = {};
  const used = new Set();
  const pick = (name, list) => {
    if (!list.length) return;
    byStep[name] = {
      from: Math.min(...list.map(s => s.start)),
      to: Math.max(...list.map(s => s.end)),
      sentences: list,
    };
    for (const s of list) used.add(s.index);
  };
  for (const st of steps) {
    const o = override[st.step];
    if (o) {
      pick(
        st.step,
        sentences.filter(s => s.index >= o[0] && s.index <= o[1])
      );
      continue;
    }
    const keys = new Set([slug(st.step), slug(st.title)].filter(Boolean));
    pick(
      st.step,
      sentences.filter(s => s.heading && keys.has(slug(s.heading)))
    );
  }
  const unmatchedHeadings = [
    ...new Set(sentences.filter(s => s.heading && !used.has(s.index)).map(s => s.heading)),
  ];
  return { byStep, unmatchedHeadings };
}

/** Zoom factor for a focus box (fractions of the frame): 1.4 unless the box does not fit. */
export function focusZoom(f) {
  if (f.zoom) return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f.zoom));
  const big = Math.max(f.w, f.h);
  let z = ZOOM;
  if (big * z > 0.95) z = 0.95 / big;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * Plan one step. Times in seconds of the raw take; frames are exact 60 fps frame numbers.
 * Returns segments (raw frame ranges with a speed), the hold and the output length in frames.
 *
 * st: {start, end, focus?}; next: the next step or null; rawFrames: frames in the raw file;
 * narrationS: seconds of narration for the step (0 or undefined: none, the step plays as it is).
 */
export function planStep({ st, index, next, narrationS = 0, rawFrames }) {
  const fromS = index === 0 ? Math.max(0, st.start - 0.5) : st.start;
  const toS = next ? next.start : st.end + 0.8;
  const fromF = Math.round(fromS * FPS);
  const toF = Math.min(rawFrames, Math.max(fromF + 1, Math.round(toS * FPS)));
  const have = (toF - fromF) / FPS;
  const need = narrationS > 0 ? narrationS + BREATH : 0;
  const focus = st.focus ?? null;
  const atF = focus ? Math.round((focus.at ?? st.start) * FPS) : null;

  /** @type {{a: number, b: number, speed: number}[]} raw frame ranges [a, b) and their speed */
  let segs = [{ a: fromF, b: toF, speed: 1 }];
  let hold = 0;
  let mode = 'plain';

  if (need > 0 && have - need > DEAD) {
    // Cut dead time: a centred fast part (ramped through 2x) between two 1x ends.
    const zoneA = fromF + Math.round(KEEP * FPS);
    let zoneB = toF - Math.round(KEEP * FPS);
    if (atF !== null) zoneB = Math.min(zoneB, atF - Math.round(0.8 * FPS));
    const ramp = Math.round(RAMP * FPS);
    // Saved time = RAMP*(1-1/2)*2 + (core - 2*RAMP)*(1 - 1/SPEEDUP); solve for the core length.
    const k = 1 - 1 / SPEEDUP;
    const wantCore = (have - need - RAMP * 0.5 * 2 + 2 * RAMP * k) / k;
    const zone = zoneB - zoneA;
    const core = Math.min(zone, Math.round(wantCore * FPS));
    if (core > 2 * ramp + Math.round(0.4 * FPS)) {
      const a = zoneA + Math.floor((zone - core) / 2);
      const b = a + core;
      segs = [
        { a: fromF, b: a, speed: 1 },
        { a, b: a + ramp, speed: 2 },
        { a: a + ramp, b: b - ramp, speed: SPEEDUP },
        { a: b - ramp, b, speed: 2 },
        { a: b, b: toF, speed: 1 },
      ].filter(s => s.b > s.a);
      mode = 'fast';
    }
  } else if (need > have) {
    const f = Math.min(MAX_SLOW, need / have);
    segs = [{ a: fromF, b: toF, speed: 1 / f }];
    hold = Math.max(0, need - have * f);
    mode = f > 1 ? 'slow' : 'plain';
  }

  // Cumulative output position (in frames, real) at the start of each segment.
  let o = 0;
  const marks = segs.map(s => {
    const m = { ...s, o };
    o += (s.b - s.a) / s.speed;
    return m;
  });
  const contentFrames = o;
  const outFrames = Math.round(contentFrames + hold * FPS);

  /** Map a raw time (seconds) to the output time (seconds) of this step. */
  const rawToOut = tRaw => {
    const f = tRaw * FPS;
    if (f <= marks[0].a) return 0;
    for (const m of marks) if (f < m.b) return (m.o + (f - m.a) / m.speed) / FPS;
    return contentFrames / FPS;
  };

  return {
    fromF,
    toF,
    have,
    need,
    mode,
    segs: marks,
    hold,
    contentFrames,
    outFrames,
    outLen: outFrames / FPS,
    rawToOut,
    focus,
  };
}

/** A setpts expression mapping the n-th frame after the step's trim to its output time. */
export function setptsExpr(plan) {
  const parts = plan.segs.map(m => {
    const n0 = m.a - plan.fromF;
    const n1 = m.b - plan.fromF;
    return { n1, e: `(${r3(m.o)}+(N-${n0})/${r3(m.speed)})/(${FPS}*TB)` };
  });
  let expr = parts.at(-1).e;
  for (let i = parts.length - 2; i >= 0; i--)
    expr = `if(lt(N,${parts[i].n1}),${parts[i].e},${expr})`;
  return expr;
}

const ease = x => `(clip(${x},0,1)*clip(${x},0,1)*(3-2*clip(${x},0,1)))`;

/**
 * The zoom factor as an ffmpeg expression of t (seconds into the step's output), or null when
 * the step neither has a focus nor a long hold. Focus: ease in, hold, ease out. Hold: a gentle
 * push-in and back so the held last frame stays alive.
 */
export function zoomExpr(plan) {
  const len = plan.outLen;
  const terms = [];
  const f = plan.focus;
  if (f) {
    const zt = focusZoom(f);
    const t0 = Math.max(0, plan.rawToOut(f.at ?? 0) - LEAD);
    const t1 = Math.max(t0 + EASE, len - EASE);
    terms.push(
      `(1+${r3(zt - 1)}*(${ease(`(t-${r3(t0)})/${EASE}`)}-${ease(`(t-${r3(t1)})/${EASE}`)}))`
    );
  }
  if (plan.hold > 0.6) {
    const t0 = plan.contentFrames / FPS;
    terms.push(`(1+${DRIFT}*0.5*(1-cos(2*PI*clip((t-${r3(t0)})/${r3(plan.hold)},0,1))))`);
  }
  return terms.length ? terms.join('*') : null;
}

/** Crop centre (fractions) for the zoom: the focus box centre, else the frame centre. */
export function zoomCenter(plan) {
  const f = plan.focus;
  return f ? { cx: f.x + f.w / 2, cy: f.y + f.h / 2 } : { cx: 0.5, cy: 0.5 };
}

/** The click ring source: a white ring growing from 0.3 to 1 of its box while fading out. */
export function ringSource({ size, seconds = RING_SECONDS }) {
  const c = size / 2;
  const R = `(${r3(c * 0.35)}+${r3(c * 0.6)}*min(T/${seconds},1))`;
  const a = `255*max(0,1-abs(hypot(X-${c},Y-${c})-${R})/${Math.max(2, Math.round(size / 40))})*max(0,1-T/${seconds})`;
  return `color=c=white:s=${size}x${size}:r=${FPS}:d=${seconds},format=yuva444p,geq=lum='p(X,Y)':cb=128:cr=128:a='${a}'`;
}

/** The cursor dot source: a filled white disc with a thin dark rim. */
export function dotSource({ size, seconds }) {
  const c = size / 2;
  const d = `hypot(X-${c},Y-${c})`;
  const lum = `if(lt(${d},${r3(c * 0.72)}),255,30)`;
  const a = `255*max(0,min(1,${r3(c - 0.5)}-${d}))`;
  return `color=c=white:s=${size}x${size}:r=${FPS}:d=${r3(seconds)},format=yuva444p,geq=lum='${lum}':cb=128:cr=128:a='${a}'`;
}

/**
 * Filter lines for one step. Input label `inLabel` (the split of the raw file) and output label
 * `label`. Several lines: the chain itself and, when `cursor` is set, a dot and a click ring
 * overlaid before the zoom, so they zoom with the picture.
 *
 * opts: {W, H, draft, cursor, prevCentre: {cx, cy}|null}
 */
export function stepFilter(
  plan,
  label,
  inLabel,
  { W, H, draft = false, cursor = false, prevCentre = null }
) {
  const z = zoomExpr(plan);
  const base = [
    `trim=start_frame=${plan.fromF}:end_frame=${plan.toF}`,
    `setpts='${setptsExpr(plan)}'`,
    `fps=${FPS}`,
    'tpad=stop_mode=clone:stop=-1',
    `trim=end_frame=${plan.outFrames}`,
    `setpts=N/(${FPS}*TB)`,
  ].join(',');
  const lines = [];
  const needsOverlay = cursor && plan.focus;
  const U = z && !draft ? 2 : 1;
  // Without an overlay the raw picture goes straight to the (2x) zoom size; with one it is
  // scaled to the output size first, so the dot and ring are drawn in output pixels.
  const size = needsOverlay ? [W, H] : [W * U, H * U];
  let zIn = `${label}_b`;
  lines.push(
    `[${inLabel}]${base},scale=${size[0]}:${size[1]}:flags=lanczos,format=yuv420p,setsar=1[${zIn}]`
  );

  if (needsOverlay) {
    const { cx, cy } = zoomCenter(plan);
    const tClick = plan.rawToOut(plan.focus.at ?? 0);
    const ringSize = Math.round(H / 7);
    const dotSize = Math.round(H / 45);
    const x1 = cx * W;
    const y1 = cy * H;
    const x0 = (prevCentre?.cx ?? 0.5) * W;
    const y0 = (prevCentre?.cy ?? 0.5) * H;
    const t0 = Math.max(0, tClick - CURSOR_TRAVEL);
    const p = ease(`(t-${r3(t0)})/${CURSOR_TRAVEL}`);
    const pos = (a, b, half) => `'${r3(a)}+(${r3(b)}-${r3(a)})*${p}-${half}'`;
    lines.push(`${dotSource({ size: dotSize, seconds: plan.outLen })}[${label}_dot]`);
    lines.push(`${ringSource({ size: ringSize })},setpts=PTS+${r3(tClick)}/TB[${label}_ring]`);
    lines.push(
      `[${zIn}][${label}_dot]overlay=x=${pos(x0, x1, dotSize / 2)}:y=${pos(y0, y1, dotSize / 2)}:eof_action=pass[${label}_d]`
    );
    lines.push(
      `[${label}_d][${label}_ring]overlay=x=${r3(x1 - ringSize / 2)}:y=${r3(y1 - ringSize / 2)}:eof_action=pass[${label}_r]`
    );
    zIn = `${label}_r`;
  }

  if (z) {
    // zoompan, not scale(eval=frame)+crop: crop reads iw/ih once at the start (zoom 1), so its
    // x/y clipped to 0 and every zoom anchored top-left. zoompan crops at whole input pixels, so
    // the master is upscaled 2x first to keep the slow zoom from wobbling.
    const { cx, cy } = zoomCenter(plan);
    const zt = z.replace(/\bt\b/g, `(on/${FPS})`);
    lines.push(
      `[${zIn}]${needsOverlay && U > 1 ? `scale=${W * U}:${H * U}:flags=lanczos,` : ''}` +
        `zoompan=z='${zt}':x='clip(${cx.toFixed(4)}*iw-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy.toFixed(4)}*ih-ih/zoom/2,0,ih-ih/zoom)':d=1:s=${W}x${H}:fps=${FPS},` +
        `format=yuv420p,setsar=1,fps=${FPS}[${label}]`
    );
  } else lines.push(`[${zIn}]scale=${W}:${H}:flags=lanczos,format=yuv420p,setsar=1[${label}]`);
  return lines;
}

/** drawtext/drawbox lines for a chapter card, as a source ending in [label]. */
export function cardFilter({ W, H, titleFile, fontBold, fontMed, brand, label }) {
  return (
    [
      `color=c=0x0f1115:s=${W}x${H}:r=${FPS}:d=${CARD}`,
      `drawbox=x='iw/2-iw*0.03':y='ih*0.40':w='iw*0.06':h='max(2,ih/270)':color=0x4ea1ff:t=fill`,
      `drawtext=fontfile='${fontBold}':textfile='${titleFile}':fontcolor=0xe6e9ef:fontsize=${Math.round(H / 13)}:x='(w-text_w)/2':y='h*0.46':alpha='min(1,t/0.35)'`,
      ...(brand
        ? [
            `drawtext=fontfile='${fontMed}':text='${brand}':fontcolor=0x9aa3b2:fontsize=${Math.round(H / 38)}:x='(w-text_w)/2':y='h*0.62':alpha='min(1,t/0.35)'`,
          ]
        : []),
      `format=yuv420p,setsar=1,fps=${FPS}`,
    ].join(',') + `[${label}]`
  );
}

/**
 * The whole filter graph of one chapter: the raw file (input 0) split into steps, each retimed
 * and zoomed, joined, then cross-faded out of the chapter card.
 * Returns {graph, bodyFrames, offset}.
 */
export function chapterGraph({
  plans,
  steps,
  glitches = [],
  card,
  W,
  H,
  draft = false,
  cursor = false,
}) {
  const g = [];
  const sel = glitches.length
    ? `select='not(${glitches.map(([a, b]) => `between(n,${a},${b})`).join('+')})',fps=${FPS},`
    : '';
  g.push(`[0:v]fps=${FPS},${sel}split=${plans.length}${plans.map((_, i) => `[s${i}]`).join('')}`);
  plans.forEach((p, i) => {
    const prev = i > 0 ? zoomCenter(plans[i - 1]) : null;
    g.push(
      ...stepFilter(p, `v${i}`, `s${i}`, {
        W,
        H,
        draft,
        cursor,
        prevCentre: plans[i - 1]?.focus ? prev : null,
      })
    );
  });
  g.push(
    `${plans.map((_, i) => `[v${i}]`).join('')}concat=n=${plans.length}:v=1:a=0,fps=${FPS}[body]`
  );
  g.push(card);
  const offset = CARD - XFADE;
  g.push(`[card][body]xfade=transition=fade:duration=${XFADE}:offset=${offset}[out]`);
  return { graph: g.join(';\n'), bodyFrames: plans.reduce((n, p) => n + p.outFrames, 0), offset };
}

/**
 * Where everything lands on the finished cut's clock. chapters: [{frames, steps: [{len, narration?}]}]
 * (frames of the chapter intermediate, the steps in order). Returns chapter starts (xfaded into
 * each other), the total length and, per step, its start and the start of its narration.
 */
export function timeline(chapters) {
  const starts = [];
  let acc = 0;
  const stepInfo = [];
  chapters.forEach((ch, j) => {
    const start = j === 0 ? 0 : acc - XFADE;
    starts.push(start);
    let local = CARD - XFADE;
    const infos = ch.steps.map(s => {
      const info = { start: start + local, len: s.len, voiceAt: start + local + LEAD_IN };
      local += s.len;
      return info;
    });
    stepInfo.push(infos);
    acc = start + ch.frames / FPS;
  });
  return { starts, total: acc, stepInfo };
}

/** The graph that cross-fades the chapter files (inputs 0..n-1) into one picture, ending in [out]. */
export function assembleGraph(frames, fadeSeconds = 0.5) {
  const g = [];
  let acc = frames[0] / FPS;
  let last = '0:v';
  for (let j = 1; j < frames.length; j++) {
    const offset = acc - XFADE;
    g.push(
      `[${last}][${j}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(4)}[x${j}]`
    );
    last = `x${j}`;
    acc = offset + frames[j] / FPS;
  }
  g.push(
    `[${last}]fade=t=in:st=0:d=${XFADE},fade=t=out:st=${Math.max(0, acc - fadeSeconds).toFixed(3)}:d=${fadeSeconds},format=yuv420p[out]`
  );
  return { graph: g.join(';\n'), total: acc };
}

/**
 * The audio graph of a cut. clips: [{input, from, to, at}] narration pieces (seconds in the input
 * file, placed at `at` on the cut's clock); music: {input, gainDb}|null. Narration is mixed, the
 * music is ducked under it with a sidechain compressor, and the sum is loudness-normalised to
 * -16 LUFS. Ends in [aout]; null when there is nothing to hear.
 */
export function audioGraph({ clips, music = null, total }) {
  if (!clips.length && !music) return null;
  const g = [];
  clips.forEach((c, k) => {
    const ms = Math.max(0, Math.round(c.at * 1000));
    g.push(
      `[${c.input}:a]atrim=start=${r3(c.from)}:end=${r3(c.to)},asetpts=PTS-STARTPTS,aresample=48000,` +
        `aformat=channel_layouts=stereo,adelay=${ms}|${ms}[n${k}]`
    );
  });
  let bus = null;
  if (clips.length) {
    g.push(
      clips.length === 1
        ? `[n0]anull[voice]`
        : `${clips.map((_, k) => `[n${k}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest[voice]`
    );
    bus = 'voice';
  }
  if (music) {
    const trim = `atrim=0:${r3(total)},asetpts=PTS-STARTPTS`;
    g.push(
      `[${music.input}:a]aloop=loop=-1:size=2147483647,${trim},aresample=48000,aformat=channel_layouts=stereo,volume=${music.gainDb ?? -14}dB[mus]`
    );
    if (bus) {
      g.push(
        `[voice]asplit=2[vkey][vmix]`,
        `[mus][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]`,
        `[duck][vmix]amix=inputs=2:normalize=0:duration=longest[sum]`
      );
      bus = 'sum';
    } else bus = 'mus';
  }
  g.push(
    `[${bus}]apad,atrim=0:${r3(total)},loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11,` +
      `afade=t=out:st=${r3(Math.max(0, total - 0.5))}:d=0.5[aout]`
  );
  return g.join(';\n');
}

/** FFMETADATA1 chapter marks; END of a chapter is the start of the next (the last one: total). */
export function chapterMetadata(marks, total) {
  const meta = [';FFMETADATA1'];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : total;
    meta.push(
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${Math.round(m.at * 1000)}`,
      `END=${Math.round(end * 1000)}`,
      `title=${m.title}`
    );
  });
  return meta.join('\n');
}

/** YouTube chapter lines, the first at 0:00. */
export function youtubeChapters(marks) {
  return (
    marks
      .map(
        m => `${Math.floor(m.at / 60)}:${String(Math.floor(m.at % 60)).padStart(2, '0')} ${m.title}`
      )
      .join('\n') + '\n'
  );
}
