/**
 * How well a recorded track lines up with what was played: windowed cross-correlation of 10 ms
 * loudness envelopes between the source file and the recorded track, around the place where
 * each window should be. The result per window is the deviation from that expected place.
 */

import { ffmpeg } from './source.js';

export const ENV_HOP_S = 0.01;
const RATE = 16000;
const HOP = RATE * ENV_HOP_S;

export function decodeMono16k(file: string, seconds = 0): Float32Array {
  const cut = seconds > 0 ? ['-t', String(seconds)] : [];
  const pcm = ffmpeg([
    '-i',
    file,
    ...cut,
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-f',
    's16le',
    'pipe:1',
  ]);
  const out = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

/** Loudness in dB per 10 ms hop (floor -80 dB). */
export function envelope(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = k * HOP; i < (k + 1) * HOP; i++) sum += x[i] * x[i];
    out[k] = Math.max(-80, 10 * Math.log10(sum / HOP + 1e-12));
  }
  return out;
}

function zscore(a: Float32Array): Float32Array | undefined {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  let varSum = 0;
  for (const v of a) varSum += (v - mean) ** 2;
  const sd = Math.sqrt(varSum / a.length);
  if (sd < 1) return undefined; // flat (silence): nothing to line up
  return a.map(v => (v - mean) / sd);
}

export interface LagResult {
  /** Best lag in hops (fractional after parabolic refinement). */
  lag: number;
  /** Normalized correlation at the best lag, -1 to 1. */
  score: number;
}

/**
 * Find where `needle` sits in `hay` around `expected` (hop index of needle[0] in hay), searching
 * `expected - maxLag` to `expected + maxLag`. Returns the lag relative to `expected`.
 */
export function bestLag(
  needle: Float32Array,
  hay: Float32Array,
  expected: number,
  maxLag: number
): LagResult | undefined {
  const a = zscore(needle);
  if (!a) return undefined;
  const scores: number[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const start = expected + lag;
    if (start < 0 || start + a.length > hay.length) {
      scores.push(-Infinity);
      continue;
    }
    const b = zscore(hay.subarray(start, start + a.length));
    if (!b) {
      scores.push(-Infinity);
      continue;
    }
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    scores.push(dot / a.length);
  }
  let best = -1;
  for (let i = 0; i < scores.length; i++) if (best < 0 || scores[i] > scores[best]) best = i;
  if (best < 0 || !Number.isFinite(scores[best])) return undefined;
  let lag = best - maxLag;
  const l = scores[best - 1];
  const r = scores[best + 1];
  if (l !== undefined && r !== undefined && Number.isFinite(l) && Number.isFinite(r)) {
    const denom = l - 2 * scores[best] + r;
    if (denom < 0) lag += (0.5 * (l - r)) / denom;
  }
  return { lag, score: scores[best] };
}

export interface WindowResult {
  /** Window start in source seconds. */
  at: number;
  /** Measured place minus expected place, in ms (positive: later than expected). */
  deviationMs: number;
  score: number;
}

export interface AlignOptions {
  windowS: number;
  stepS: number;
  maxLagS: number;
  minScore: number;
}

export const DEFAULT_ALIGN: AlignOptions = { windowS: 20, stepS: 10, maxLagS: 1.5, minScore: 0.5 };

/**
 * Compare source and recorded envelopes. `offsetS` is where source time 0 should sit in the
 * recording (the play start on the recorder's clock).
 */
export function alignWindows(
  source: Float32Array,
  recorded: Float32Array,
  offsetS: number,
  opts: AlignOptions = DEFAULT_ALIGN
): WindowResult[] {
  const win = Math.round(opts.windowS / ENV_HOP_S);
  const step = Math.round(opts.stepS / ENV_HOP_S);
  const maxLag = Math.round(opts.maxLagS / ENV_HOP_S);
  const out: WindowResult[] = [];
  for (let s = 0; s + win <= source.length; s += step) {
    const expected = s + Math.round(offsetS / ENV_HOP_S);
    // Only windows with the whole search range inside the recording: a cut range finds a
    // wrong best lag at the edges.
    if (expected - maxLag < 0 || expected + maxLag + win > recorded.length) continue;
    const fit = bestLag(source.subarray(s, s + win), recorded, expected, maxLag);
    if (!fit || fit.score < opts.minScore) continue;
    out.push({ at: s * ENV_HOP_S, deviationMs: fit.lag * ENV_HOP_S * 1000, score: fit.score });
  }
  return out;
}

export interface Spread {
  windows: number;
  medianMs: number;
  /** 95th percentile of |deviation - median|: how much the alignment wanders. */
  p95SpreadMs: number;
  maxSpreadMs: number;
}

export function spread(windows: WindowResult[]): Spread | undefined {
  if (windows.length === 0) return undefined;
  const devs = windows.map(w => w.deviationMs).sort((a, b) => a - b);
  const median = devs[Math.floor(devs.length / 2)];
  const abs = devs.map(d => Math.abs(d - median)).sort((a, b) => a - b);
  return {
    windows: windows.length,
    medianMs: Math.round(median * 10) / 10,
    p95SpreadMs: Math.round(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] * 10) / 10,
    maxSpreadMs: Math.round(abs[abs.length - 1] * 10) / 10,
  };
}
