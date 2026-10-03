import { describe, expect, it } from 'vitest';
import { OggOpusWriter } from '../convert/ogg.js';
import { alignWindows, bestLag, spread } from './compare.js';
import { opusPacketSamples, readOggOpus } from './ogg-read.js';
import { DEFAULT_GATE, frameLevels, speakerName, speechGate } from './source.js';

describe('readOggOpus', () => {
  it('reads back what the writer wrote, including packets longer than 255 bytes', () => {
    const packets = [
      Buffer.alloc(10, 1),
      Buffer.alloc(300, 2),
      Buffer.alloc(255, 3),
      Buffer.alloc(1),
    ];
    const many = Array.from({ length: 400 }, (_, i) => Buffer.alloc(40 + (i % 7), i % 256));
    const w = new OggOpusWriter(7, 2);
    for (const p of [...packets, ...many]) w.write(p, 960);
    const back = readOggOpus(w.finish());
    expect(back.channels).toBe(2);
    expect(back.preSkip).toBe(0);
    expect(back.packets).toHaveLength(packets.length + many.length);
    back.packets.forEach((p, i) => expect(p.equals([...packets, ...many][i])).toBe(true));
  });

  it('rejects a file that is not Ogg', () => {
    expect(() => readOggOpus(Buffer.from('RIFF....WAVEfmt nothing to see here at all'))).toThrow();
  });
});

describe('opusPacketSamples', () => {
  it('reads the frame size from the TOC byte', () => {
    expect(opusPacketSamples(Buffer.from([(1 << 3) | 0]))).toBe(960); // SILK 20 ms, one frame
    expect(opusPacketSamples(Buffer.from([(31 << 3) | 0]))).toBe(960); // CELT 20 ms
    expect(opusPacketSamples(Buffer.from([(31 << 3) | 1]))).toBe(1920); // two frames
    expect(opusPacketSamples(Buffer.from([(29 << 3) | 3, 3]))).toBe(720); // 3 x 5 ms
    expect(opusPacketSamples(Buffer.alloc(0))).toBe(0);
  });
});

describe('speech gate', () => {
  it('measures frame levels in dBFS', () => {
    const pcm = Buffer.alloc(960 * 2 * 2);
    for (let i = 0; i < 960; i++) pcm.writeInt16LE(16384, i * 2); // first frame at half scale
    const [loud, quiet] = frameLevels(pcm);
    expect(loud).toBeCloseTo(-6.02, 1);
    expect(quiet).toBeLessThan(-100);
  });

  it('sends speech with preroll and hangover, and nothing in long silence', () => {
    const levels = [-90, -90, -10, -12, -90, ...new Array<number>(20).fill(-90), -15, -90];
    const send = speechGate(levels, { ...DEFAULT_GATE, hangover: 3, preroll: 1 });
    expect(send.slice(0, 8)).toEqual([false, true, true, true, true, true, true, false]);
    expect(send[24]).toBe(true); // preroll before the last burst
    expect(send[25]).toBe(true);
    expect(send.slice(8, 24).every(v => !v)).toBe(true);
  });

  it('never treats a quiet track as all speech', () => {
    expect(speechGate([-70, -72, -71]).every(v => !v)).toBe(true);
  });

  it('names speakers like the transcriber does', () => {
    expect(speakerName('C:/x/S1__danni_d.wav')).toBe('danni_d');
    expect(speakerName('2-anna.ogg')).toBe('anna');
    expect(speakerName('bo.flac')).toBe('bo');
  });
});

describe('alignment', () => {
  // A pseudo speech envelope: bursts of loudness with pauses, 10 ms per value.
  function speechLike(n: number, seed = 1): Float32Array {
    let s = seed;
    const rnd = (): number => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const out = new Float32Array(n);
    let level = -70;
    for (let i = 0; i < n; i++) {
      if (i % 37 === 0) level = rnd() < 0.5 ? -70 : -20 - rnd() * 15;
      out[i] = level + rnd() * 6;
    }
    return out;
  }

  it('finds a known shift', () => {
    const src = speechLike(3000);
    const rec = new Float32Array(3500).fill(-80);
    rec.set(src, 123); // played 1.23 s into the recording
    const fit = bestLag(src.subarray(500, 2500), rec, 500 + 120, 50);
    expect(fit?.lag).toBeCloseTo(3, 0);
    expect(fit!.score).toBeGreaterThan(0.95);
  });

  it('reports deviations per window and their spread', () => {
    const src = speechLike(6000, 7);
    const rec = new Float32Array(7000).fill(-80);
    rec.set(src.subarray(0, 3000), 100); // first half 1.00 s in
    rec.set(src.subarray(3000), 3105); // second half 50 ms later (a re-anchor that slipped)
    const windows = alignWindows(src, rec, 1.0, {
      windowS: 5,
      stepS: 5,
      maxLagS: 0.5,
      minScore: 0.5,
    });
    expect(windows.length).toBeGreaterThan(8);
    expect(windows[0].deviationMs).toBeCloseTo(0, -1);
    expect(windows[windows.length - 1].deviationMs).toBeCloseTo(50, -1);
    const s = spread(windows)!;
    expect(s.maxSpreadMs).toBeGreaterThanOrEqual(40);
  });

  it('skips silent windows', () => {
    const src = new Float32Array(3000).fill(-80);
    expect(alignWindows(src, src, 0)).toEqual([]);
    expect(spread([])).toBeUndefined();
  });
});
