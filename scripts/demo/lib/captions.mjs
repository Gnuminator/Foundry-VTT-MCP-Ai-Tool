// Captions for the compose command: wrap narration lines into cues of at most 2 lines of 42
// characters, and write them as SRT and VTT (sidecars) and ASS (burned in).

export const LINE = 42;
export const MAX_LINES = 2;

/** Greedy word wrap at `width` characters. */
export function wrap(text, width = LINE) {
  const lines = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Split words into one or two lines of at most `width` characters, as even as possible. */
function balanced(words, width = LINE) {
  const whole = words.join(' ');
  if (whole.length <= width) return [whole];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length > width || b.length > width) continue;
    const score = Math.max(a.length, b.length);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best?.lines ?? null;
}

/**
 * One narration line shown from `start` to `end` becomes one or more cues of at most two
 * lines of 42 characters; the words are shared out evenly (no orphan cue with two words) and
 * the time by characters.
 */
export function cuesFor(text, start, end) {
  const words = text.split(/\s+/).filter(Boolean);
  const chars = words.join(' ').length;
  for (let n = Math.max(1, Math.ceil(chars / (LINE * MAX_LINES * 0.9))); n <= words.length; n++) {
    const target = chars / n;
    const chunks = [];
    let cur = [];
    for (const w of words) {
      const len = [...cur, w].join(' ').length;
      if (
        cur.length &&
        chunks.length < n - 1 &&
        Math.abs(len - target) > Math.abs(cur.join(' ').length - target)
      ) {
        chunks.push(cur);
        cur = [w];
      } else cur.push(w);
    }
    chunks.push(cur);
    const grouped = chunks.map(c => balanced(c));
    if (grouped.some(g => !g)) continue;
    const total = grouped.reduce((s, g) => s + g.join(' ').length, 0) || 1;
    const cues = [];
    let t = start;
    for (const lines of grouped) {
      const dur = ((end - start) * lines.join(' ').length) / total;
      cues.push({ start: t, end: t + dur, lines });
      t += dur;
    }
    return cues;
  }
  return [{ start, end, lines: wrap(text) }];
}

const p = (v, l = 2) => String(v).padStart(l, '0');

export function srtTime(s) {
  const ms = Math.round(s * 1000);
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** WebVTT: the SRT cues with a header and dots in the times. */
export function toVtt(cues) {
  const t = s => srtTime(s).replace(',', '.');
  return `WEBVTT\n\n${cues.map(c => `${t(c.start)} --> ${t(c.end)}\n${c.lines.join('\n')}\n`).join('\n')}`;
}

export function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}\n`)
    .join('\n');
}

const assTime = s => {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};

/**
 * An ASS file for a video of W x H pixels. The box behind the text is the style's outline
 * (BorderStyle 3) in a translucent near-black, with padding from Outline.
 */
export function toAss(cues, { W, H, font = 'Segoe UI' }) {
  const size = Math.round(H / 24);
  const pad = Math.round(H / 60);
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${font},${size},&H00EFE9E6,&H00EFE9E6,&H4015110F,&H00000000,0,0,0,0,100,100,0,0,3,${pad},0,2,${Math.round(W / 8)},${Math.round(W / 8)},${Math.round(H / 14)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = cues.map(
    c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${c.lines.join('\\N')}`
  );
  return [...head, ...ev, ''].join('\n');
}
