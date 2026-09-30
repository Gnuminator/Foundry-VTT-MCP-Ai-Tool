/**
 * Put one speaker's packets back on the session timeline.
 *
 * Discord only sends packets while someone speaks, so the gaps have to be filled with silence
 * for every track to line up from session start. Placement:
 *
 * - the first packet of a burst of speech (after more than {@link BURST_GAP} without packets)
 *   is placed by its arrival time and becomes the RTP anchor, unless the RTP estimate from the
 *   previous anchor is within {@link BURST_TOLERANCE} of it (network jitter only);
 * - inside a burst, packets are placed by RTP timestamp relative to the anchor, which is exact
 *   and ignores jitter; a jump of more than {@link HARD_TOLERANCE} re-anchors on arrival;
 * - packets without RTP data are placed by arrival time.
 *
 * A packet that would land before the end of the previous one is written right after it.
 */

import { type PacketRecord } from '../rec/format.js';
import { SAMPLES_PER_FRAME, SILENCE_FRAME, isDaveEncrypted, opusPacketSamples } from './opus.js';

export const BURST_GAP = 9_600; // 200 ms
export const BURST_TOLERANCE = 2_880; // 60 ms
export const HARD_TOLERANCE = 24_000; // 500 ms

export interface TimelineStats {
  packets: number;
  silenceFrames: number;
  droppedDave: number;
  droppedInvalid: number;
  duplicates: number;
  reanchors: number;
  /** Largest amount a packet had to be pushed later than its ideal place, in samples. */
  maxLateSamples: number;
  /** Total length written, in 48 kHz samples. */
  endSamples: number;
}

export interface TimelinePacket {
  packet: Buffer;
  samples: number;
}

/** Signed difference `a - b` of two u32 RTP timestamps (handles wrap-around). */
export function rtpDiff(a: number, b: number): number {
  return (a - b) | 0;
}

/** Signed difference of two u16 RTP sequence numbers. */
export function seqDiff(a: number, b: number): number {
  const d = (a - b) & 0xffff;
  return d >= 0x8000 ? d - 0x10000 : d;
}

export function buildTimeline(
  records: readonly PacketRecord[],
  emit: (p: TimelinePacket) => void
): TimelineStats {
  const stats: TimelineStats = {
    packets: 0,
    silenceFrames: 0,
    droppedDave: 0,
    droppedInvalid: 0,
    duplicates: 0,
    reanchors: 0,
    maxLateSamples: 0,
    endSamples: 0,
  };
  let cursor = 0;
  let anchor: { pos: number; rtp: number } | null = null;
  let lastSeq: number | null = null;
  let lastArrival: number | null = null;

  for (const rec of records) {
    const samples = opusPacketSamples(rec.payload);
    if (samples === 0) {
      stats.droppedInvalid++;
      continue;
    }
    if (isDaveEncrypted(rec.payload)) {
      stats.droppedDave++;
      continue;
    }
    if (rec.hasRtp && lastSeq !== null) {
      const d = seqDiff(rec.seq, lastSeq);
      if (d <= 0 && d > -1000) {
        stats.duplicates++;
        continue;
      }
    }

    const arrivalPos = Math.max(0, rec.arrival - samples);
    const newBurst = lastArrival === null || rec.arrival - lastArrival > BURST_GAP;
    let target = arrivalPos;
    if (rec.hasRtp) {
      if (anchor) {
        const rtpPos = anchor.pos + rtpDiff(rec.rtpTimestamp, anchor.rtp);
        const tolerance = newBurst ? BURST_TOLERANCE : HARD_TOLERANCE;
        if (Math.abs(rtpPos - arrivalPos) <= tolerance) {
          target = rtpPos;
        } else {
          anchor = { pos: arrivalPos, rtp: rec.rtpTimestamp };
          stats.reanchors++;
        }
      } else {
        anchor = { pos: arrivalPos, rtp: rec.rtpTimestamp };
      }
    }

    const gap = target - cursor;
    if (gap >= SAMPLES_PER_FRAME) {
      const frames = Math.floor(gap / SAMPLES_PER_FRAME);
      for (let i = 0; i < frames; i++) emit({ packet: SILENCE_FRAME, samples: SAMPLES_PER_FRAME });
      stats.silenceFrames += frames;
      cursor += frames * SAMPLES_PER_FRAME;
    } else if (gap < 0) {
      stats.maxLateSamples = Math.max(stats.maxLateSamples, -gap);
    }

    emit({ packet: rec.payload, samples });
    stats.packets++;
    cursor += samples;
    if (rec.hasRtp) lastSeq = rec.seq;
    lastArrival = rec.arrival;
  }

  stats.endSamples = cursor;
  return stats;
}
