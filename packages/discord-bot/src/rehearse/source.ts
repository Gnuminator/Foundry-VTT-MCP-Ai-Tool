/**
 * Prepare the audio a speaker bot plays: one source file per speaker becomes 20 ms Opus frames
 * (ffmpeg, libopus) plus a speech gate per frame. Like a real Discord client, a speaker bot only
 * sends while its speaker talks, so the recorder sees bursts with gaps, not one endless stream.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readOggOpus } from './ogg-read.js';

export const FRAME_SAMPLES = 960; // 20 ms at 48 kHz
const AUDIO = new Set(['.wav', '.flac', '.ogg', '.oga', '.opus', '.mp3', '.m4a']);

export interface Source {
  /** Speaker name from the file name (`S1__anna.wav` and `anna.wav` give `anna`). */
  name: string;
  file: string;
  /** One Opus packet per 20 ms frame, frame 0 at the start of the file. */
  packets: Buffer[];
  /** Whether frame i is sent (speech plus a short hangover). */
  send: boolean[];
  sendFrames: number;
}

export interface GateOptions {
  /** Speech is louder than (loudest frame - `rangeDb`), and never quieter than `floorDb`. */
  rangeDb: number;
  floorDb: number;
  /** Frames kept after speech stops (Discord clients send a little after the voice ends). */
  hangover: number;
  /** Frames sent before speech starts. */
  preroll: number;
}

export const DEFAULT_GATE: GateOptions = { rangeDb: 40, floorDb: -50, hangover: 10, preroll: 1 };

export function ffmpeg(args: string[]): Buffer {
  const done = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (done.error) throw new Error(`ffmpeg could not start (${done.error.message}); is it on PATH?`);
  if (done.status !== 0) throw new Error(`ffmpeg failed: ${done.stderr.toString().slice(-400)}`);
  return done.stdout;
}

/** dBFS of each 20 ms frame of 48 kHz mono s16le PCM. */
export function frameLevels(pcm: Buffer): number[] {
  const samples = Math.floor(pcm.length / 2);
  const out: number[] = [];
  for (let start = 0; start + FRAME_SAMPLES <= samples; start += FRAME_SAMPLES) {
    let sum = 0;
    for (let i = start; i < start + FRAME_SAMPLES; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
    }
    out.push(10 * Math.log10(sum / FRAME_SAMPLES + 1e-12));
  }
  return out;
}

/** Which frames a client would send: speech frames, widened by preroll and hangover. */
export function speechGate(levels: number[], opts: GateOptions = DEFAULT_GATE): boolean[] {
  const peak = levels.reduce((a, b) => Math.max(a, b), -120); // no spread: hours of frames
  const threshold = Math.max(peak - opts.rangeDb, opts.floorDb);
  const send = new Array<boolean>(levels.length).fill(false);
  levels.forEach((db, i) => {
    if (db <= threshold) return;
    for (
      let j = Math.max(0, i - opts.preroll);
      j <= Math.min(levels.length - 1, i + opts.hangover);
      j++
    )
      send[j] = true;
  });
  return send;
}

export function speakerName(file: string): string {
  const stem = basename(file, extname(file));
  return (stem.includes('__') ? stem.slice(stem.indexOf('__') + 2) : stem).replace(/^\d+-/, '');
}

export function listSources(folder: string): string[] {
  return readdirSync(folder)
    .filter(f => AUDIO.has(extname(f).toLowerCase()))
    .sort()
    .map(f => join(folder, f));
}

/** Encode and gate one file; `seconds` cuts it short (0 = whole file). */
export function prepareSource(file: string, workDir: string, seconds = 0): Source {
  mkdirSync(workDir, { recursive: true });
  const cut = seconds > 0 ? ['-t', String(seconds)] : [];
  const ogg = join(workDir, `${basename(file, extname(file))}.opus.ogg`);
  ffmpeg([
    '-y',
    '-i',
    file,
    ...cut,
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    '64k',
    '-frame_duration',
    '20',
    '-application',
    'voip',
    ogg,
  ]);
  const { packets } = readOggOpus(readFileSync(ogg));
  const pcm = ffmpeg(['-i', file, ...cut, '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']);
  const send = speechGate(frameLevels(pcm)).slice(0, packets.length);
  while (send.length < packets.length) send.push(false);
  return {
    name: speakerName(file),
    file,
    packets,
    send,
    sendFrames: send.filter(Boolean).length,
  };
}
