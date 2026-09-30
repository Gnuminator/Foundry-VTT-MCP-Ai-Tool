import { describe, expect, it } from 'vitest';
import type { PacketRecord } from '../rec/format.js';
import { SAMPLES_PER_FRAME, SILENCE_FRAME, isDaveEncrypted, opusPacketSamples } from './opus.js';
import { buildTimeline, rtpDiff, seqDiff, type TimelinePacket } from './timeline.js';

/** A fake 20 ms CELT FB stereo packet (TOC 0xFC) tagged with an id byte. */
function voice(id: number): Buffer {
  return Buffer.from([0xfc, id, 0x01, 0x02]);
}

function rec(arrival: number, seq: number, ts: number, id: number, hasRtp = true): PacketRecord {
  return { arrival, seq, rtpTimestamp: ts, hasRtp, payload: voice(id) };
}

function run(
  records: PacketRecord[]
): { out: TimelinePacket[]; ids: (number | 'S')[] } & ReturnType<typeof buildTimeline> {
  const out: TimelinePacket[] = [];
  const stats = buildTimeline(records, p => out.push(p));
  const ids = out.map(p => (p.packet.equals(SILENCE_FRAME) ? 'S' : p.packet[1]));
  return { out, ids, ...stats };
}

describe('opus helpers', () => {
  it('counts samples from the TOC byte', () => {
    expect(opusPacketSamples(Buffer.from([0xfc]))).toBe(960); // CELT FB 20 ms, one frame
    expect(opusPacketSamples(Buffer.from([0x78]))).toBe(960); // Hybrid FB 20 ms (config 15)
    expect(opusPacketSamples(Buffer.from([0xf9]))).toBe(1920); // two frames
    expect(opusPacketSamples(Buffer.from([0xfb, 0x03]))).toBe(2880); // code 3, three frames
    expect(opusPacketSamples(Buffer.from([0x0b, 0x3f]))).toBe(0); // 63 x 20 ms is more than 120 ms
    expect(opusPacketSamples(Buffer.alloc(0))).toBe(0);
    expect(opusPacketSamples(SILENCE_FRAME)).toBe(SAMPLES_PER_FRAME);
  });

  it('spots frames still under DAVE encryption', () => {
    expect(isDaveEncrypted(Buffer.from([0xfc, 1, 2, 0xfa, 0xfa]))).toBe(true);
    expect(isDaveEncrypted(voice(1))).toBe(false);
    expect(isDaveEncrypted(SILENCE_FRAME)).toBe(false);
  });

  it('handles RTP wrap-around', () => {
    expect(rtpDiff(100, 0xffffff00)).toBe(356);
    expect(rtpDiff(0xffffff00, 100)).toBe(-356);
    expect(seqDiff(2, 0xfffe)).toBe(4);
    expect(seqDiff(0xfffe, 2)).toBe(-4);
  });
});

describe('buildTimeline', () => {
  it('pads the start of the session with silence up to the first packet', () => {
    // Arrives at 1.0 s (end of the frame), so the frame starts at 0.98 s = 49 frames in.
    const r = run([rec(48_000, 1, 5000, 1)]);
    expect(r.silenceFrames).toBe(49);
    expect(r.ids.slice(-2)).toEqual(['S', 1]);
    expect(r.endSamples).toBe(48_000);
  });

  it('keeps a burst contiguous by RTP despite arrival jitter', () => {
    const base = 960;
    const r = run([
      rec(base, 10, 0, 1),
      rec(base + 960 + 700, 11, 960, 2), // 15 ms late
      rec(base + 1920 - 200, 12, 1920, 3), // early
      rec(base + 2880, 13, 2880, 4),
    ]);
    expect(r.ids).toEqual([1, 2, 3, 4]);
    expect(r.reanchors).toBe(0);
  });

  it('fills a pause inside the stream from RTP, not from arrival time', () => {
    const r = run([
      rec(960, 1, 0, 1),
      // 1 s pause by RTP; the packet arrives 40 ms later than that (jitter), still one burst start
      rec(960 + 48_960 + 1_920, 2, 48_960, 2),
    ]);
    expect(r.ids).toEqual([1, ...Array(50).fill('S'), 2]);
    expect(r.reanchors).toBe(0);
  });

  it('re-anchors on arrival when RTP disagrees at the start of a burst', () => {
    const r = run([
      rec(960, 1, 0, 1),
      rec(960 + 96_000, 2, 900_000, 2), // sender reset its RTP clock
    ]);
    expect(r.reanchors).toBe(1);
    // placed by arrival: 2 s after the first packet ends
    expect(r.endSamples).toBe(960 + 96_000);
  });

  it('drops duplicates, undecrypted and invalid packets', () => {
    const r = run([
      rec(960, 5, 0, 1),
      rec(960, 5, 0, 1), // duplicate
      {
        arrival: 1920,
        seq: 6,
        rtpTimestamp: 960,
        hasRtp: true,
        payload: Buffer.from([0xfc, 9, 0xfa, 0xfa]),
      },
      { arrival: 2880, seq: 7, rtpTimestamp: 1920, hasRtp: true, payload: Buffer.alloc(0) },
      rec(3840, 8, 2880, 2),
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.droppedDave).toBe(1);
    expect(r.droppedInvalid).toBe(1);
    // the dropped 20 ms frames become silence so packet 2 keeps its place
    expect(r.ids).toEqual([1, 'S', 'S', 2]);
  });

  it('places packets without RTP by arrival time', () => {
    const r = run([rec(960, 0, 0, 1, false), rec(960 + 9_600, 0, 0, 2, false)]);
    expect(r.ids).toEqual([1, ...Array(9).fill('S'), 2]);
  });

  it('writes a late packet right after the previous one', () => {
    const r = run([rec(1920, 1, 0, 1, false), rec(1920, 0, 0, 2, false)]);
    expect(r.ids).toEqual(['S', 1, 2]);
    expect(r.maxLateSamples).toBe(960);
  });
});
