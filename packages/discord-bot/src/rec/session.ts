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

/** Called once per failing file with a short name for the file and the error. */
export type StreamErrorHandler = (what: string, err: Error) => void;

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

/** End a stream and wait for it; a stream that already failed is closed without waiting for a flush. */
function closeStream(stream: WriteStream): Promise<void> {
  return new Promise<void>(resolve => {
    if (stream.destroyed) {
      resolve();
      return;
    }
    stream.once('close', () => resolve());
    stream.end();
  });
}

export class RecordingSession {
  readonly startedAt: Date;
  private readonly tracks = new Map<string, OpenTrack>();
  private readonly events: WriteStream;
  private debugLog: WriteStream | undefined;
  private stopped = false;
  private readonly failed = new Set<string>();

  /**
   * `onStreamError` hears about a disk problem (full disk, no permission) once per file. A failed
   * file stops taking data; the others keep recording, and nothing crashes the process.
   */
  constructor(
    readonly dir: string,
    private readonly clock: Clock,
    private readonly meta: Record<string, unknown> = {},
    now: Date = new Date(),
    private readonly onStreamError: StreamErrorHandler = () => undefined
  ) {
    this.startedAt = now;
    mkdirSync(join(dir, 'raw'), { recursive: true });
    this.events = this.guard(
      createWriteStream(join(dir, 'raw', 'events.jsonl'), { flags: 'a' }),
      'events.jsonl'
    );
    this.log({ type: 'session_start', wallClock: now.toISOString(), ...meta });
  }

  /** Files that failed to write so far (names relative to `raw/`). */
  get failedFiles(): string[] {
    return [...this.failed];
  }

  private guard(stream: WriteStream, what: string): WriteStream {
    stream.on('error', err => {
      if (this.failed.has(what)) return;
      this.failed.add(what);
      try {
        this.onStreamError(what, err);
      } catch {
        // the report must never take the recorder down
      }
    });
    return stream;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  log(event: SessionEvent): void {
    if (this.stopped) return;
    this.events.write(`${JSON.stringify({ t: this.clock.now(), ...event })}\n`);
  }

  /** Append a (redacted) library debug line to `raw/voice-debug.log`. */
  debug(line: string): void {
    if (this.stopped) return;
    this.debugLog ??= this.guard(
      createWriteStream(join(this.dir, 'raw', 'voice-debug.log'), { flags: 'a' }),
      'voice-debug.log'
    );
    this.debugLog.write(`${this.clock.now()} ${line}\n`);
  }

  /** Write one Opus packet for a speaker, opening their track on first use. */
  packet(speaker: SpeakerInfo, payload: Buffer, rtp: RtpInfo | undefined): void {
    if (this.stopped) return;
    const arrival = this.clock.now();
    let open = this.tracks.get(speaker.userId);
    open ??= this.openTrack(speaker);
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
    const stream = this.guard(createWriteStream(join(this.dir, 'raw', file)), file);
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
    const closes = [...this.tracks.values()].map(t => closeStream(t.stream));
    closes.push(closeStream(this.events));
    if (this.debugLog) closes.push(closeStream(this.debugLog));
    await Promise.all(closes);
    const tracks = this.summaries();
    try {
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
            ...(this.failed.size ? { failedFiles: [...this.failed] } : {}),
            tracks,
          },
          null,
          2
        )}\n`
      );
    } catch (err) {
      // The .rec headers still carry the ids, so conversion works without session.json.
      this.failed.add('session.json');
      this.onStreamError('session.json', err as Error);
    }
    return tracks;
  }
}
