/**
 * One recording session on disk: a `.rec` file per speaker, an append-only `events.jsonl` (safe
 * against crashes) and a `session.json` written when the session stops.
 *
 * The session clock and the files live outside the voice connection, so a dropped connection
 * only shows up as silence plus logged events; the converter lines everything up afterwards.
 */

import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { encodeRecord, encodeTrackHeader } from './format.js';

export interface Clock {
  /** Session time in 48 kHz samples. */
  now(): number;
}

export function hrtimeClock(): Clock {
  const start = process.hrtime.bigint();
  // ns -> samples at 48 kHz: ns * 48000 / 1e9 = ns * 6 / 125000
  return { now: () => Number(((process.hrtime.bigint() - start) * 6n) / 125_000n) };
}

export interface SpeakerInfo {
  userId: string;
  username: string;
  displayName: string;
}

export interface TrackSummary extends SpeakerInfo {
  track: number;
  file: string;
  packets: number;
  bytes: number;
}

export type SessionEvent = Record<string, unknown> & { type: string };

export interface RtpInfo {
  seq: number;
  timestamp: number;
}

interface OpenTrack {
  summary: TrackSummary;
  stream: WriteStream;
}

/** Lower case, letters, digits, dot, dash and underscore; like the transcriber's ``slug``. */
export function slug(text: string): string {
  const s = text
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_.-]+/gu, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return s || 'speaker';
}

export class RecordingSession {
  readonly startedAt: Date;
  private readonly tracks = new Map<string, OpenTrack>();
  private readonly events: WriteStream;
  private stopped = false;

  constructor(
    readonly dir: string,
    private readonly clock: Clock,
    private readonly meta: Record<string, unknown> = {},
    now: Date = new Date()
  ) {
    this.startedAt = now;
    mkdirSync(join(dir, 'raw'), { recursive: true });
    this.events = createWriteStream(join(dir, 'raw', 'events.jsonl'), { flags: 'a' });
    this.log({ type: 'session_start', wallClock: now.toISOString(), ...meta });
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  log(event: SessionEvent): void {
    if (this.stopped) return;
    this.events.write(`${JSON.stringify({ t: this.clock.now(), ...event })}\n`);
  }

  /** Write one Opus packet for a speaker, opening their track on first use. */
  packet(speaker: SpeakerInfo, payload: Buffer, rtp: RtpInfo | undefined): void {
    if (this.stopped) return;
    const arrival = this.clock.now();
    let open = this.tracks.get(speaker.userId);
    if (!open) open = this.openTrack(speaker);
    const buf = encodeRecord({
      arrival,
      seq: rtp?.seq ?? 0,
      rtpTimestamp: rtp?.timestamp ?? 0,
      hasRtp: rtp !== undefined,
      payload,
    });
    open.stream.write(buf);
    open.summary.packets++;
    open.summary.bytes += buf.length;
  }

  private openTrack(speaker: SpeakerInfo): OpenTrack {
    const track = this.tracks.size + 1;
    const file = `${track}-${slug(speaker.username)}.rec`;
    const stream = createWriteStream(join(this.dir, 'raw', file));
    stream.write(
      encodeTrackHeader({
        v: 1,
        userId: speaker.userId,
        track,
        sessionStart: this.startedAt.toISOString(),
      })
    );
    const open: OpenTrack = {
      summary: { ...speaker, track, file, packets: 0, bytes: 0 },
      stream,
    };
    this.tracks.set(speaker.userId, open);
    this.log({ type: 'track_open', userId: speaker.userId, track, file });
    return open;
  }

  summaries(): TrackSummary[] {
    return [...this.tracks.values()].map(t => ({ ...t.summary }));
  }

  /** Close every file and write `session.json`. */
  async stop(reason: string): Promise<TrackSummary[]> {
    if (this.stopped) return this.summaries();
    this.log({ type: 'session_stop', reason });
    const endSamples = this.clock.now();
    this.stopped = true;
    const closes = [...this.tracks.values()].map(
      t => new Promise<void>(resolve => t.stream.end(resolve))
    );
    closes.push(new Promise<void>(resolve => this.events.end(resolve)));
    await Promise.all(closes);
    const tracks = this.summaries();
    writeFileSync(
      join(this.dir, 'raw', 'session.json'),
      `${JSON.stringify(
        {
          v: 1,
          startedAt: this.startedAt.toISOString(),
          stoppedAt: new Date().toISOString(),
          endSamples,
          sampleRate: 48000,
          stopReason: reason,
          ...this.meta,
          tracks,
        },
        null,
        2
      )}\n`
    );
    return tracks;
  }
}
