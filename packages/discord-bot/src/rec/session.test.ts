import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertSession } from '../convert/convert.js';
import { decodeTrack, encodeRecord } from './format.js';
import { parseRtpHeader } from './rtp-tap.js';
import { RecordingSession, slug, type Clock } from './session.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'discord-rec-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeClock(): Clock & { t: number } {
  const c = { t: 0, now: () => c.t };
  return c;
}

const anna = { userId: '111', username: 'anna.b', displayName: 'Anna' };
const bo = { userId: '222', username: 'Bo Ø', displayName: 'Bo' };
const frame = (id: number): Buffer => Buffer.from([0xfc, id, 0, 0]);

describe('slug', () => {
  it('matches the transcriber rules', () => {
    expect(slug('Bo Ø')).toBe('bo_ø');
    expect(slug('  __x__ ')).toBe('x');
    expect(slug('!!!')).toBe('speaker');
  });
});

describe('parseRtpHeader', () => {
  it('reads seq, timestamp and ssrc from an RTP v2 header', () => {
    const msg = Buffer.alloc(16);
    msg[0] = 0x80;
    msg.writeUInt16BE(513, 2);
    msg.writeUInt32BE(123_456, 4);
    msg.writeUInt32BE(42, 8);
    expect(parseRtpHeader(msg)).toEqual({ seq: 513, timestamp: 123_456, ssrc: 42 });
    expect(parseRtpHeader(Buffer.alloc(8))).toBeUndefined();
  });
});

describe('RecordingSession + convertSession', () => {
  it('records two speakers and converts them to aligned Craig-style tracks', async () => {
    const dir = tempDir();
    const clock = fakeClock();
    const s = new RecordingSession(
      dir,
      clock,
      { channelId: 'c1' },
      new Date('2026-10-04T17:30:00Z')
    );
    clock.t = 48_000; // 1 s in
    s.packet(anna, frame(1), { seq: 1, timestamp: 1000 });
    clock.t = 48_960;
    s.packet(anna, frame(2), { seq: 2, timestamp: 1960 });
    clock.t = 96_000; // 2 s in
    s.packet(bo, frame(3), undefined);
    const tracks = await s.stop('test');

    expect(tracks.map(t => [t.track, t.file, t.packets])).toEqual([
      [1, '1-anna.b.rec', 2],
      [2, '2-bo_ø.rec', 1],
    ]);
    const decoded = decodeTrack(readFileSync(join(dir, 'raw', '1-anna.b.rec')));
    expect(decoded.header).toMatchObject({ userId: '111', track: 1 });
    expect(decoded.records[1]).toMatchObject({ arrival: 48_960, seq: 2, hasRtp: true });

    const events = readFileSync(join(dir, 'raw', 'events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(events[0])).toMatchObject({ type: 'session_start', channelId: 'c1' });
    expect(JSON.parse(events.at(-1)!)).toMatchObject({ type: 'session_stop', reason: 'test' });

    const result = convertSession(dir);
    expect(result.tracks.map(t => t.file)).toEqual(['1-anna.b.ogg', '2-bo_ø.ogg']);
    const [a, b] = result.tracks;
    // Anna's first frame starts at 0.98 s: 49 silence frames, then 2 packets.
    expect(a.stats).toMatchObject({ packets: 2, silenceFrames: 49 });
    expect(a.seconds).toBe(1.02);
    expect(b.stats).toMatchObject({ packets: 1, silenceFrames: 99 });
    expect(existsSync(join(dir, '1-anna.b.ogg'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'speakers.json'), 'utf8'))).toEqual({
      'anna.b': { player: 'Anna' },
      bo_ø: { player: 'Bo' },
    });
    expect(existsSync(join(dir, 'raw', 'convert-report.json'))).toBe(true);
  });

  it('keeps a hand-edited speakers.json and survives a crash (no session.json, cut-off record)', async () => {
    const dir = tempDir();
    const clock = fakeClock();
    const s = new RecordingSession(dir, clock);
    clock.t = 960;
    s.packet(anna, frame(1), undefined);
    await s.stop('test');
    rmSync(join(dir, 'raw', 'session.json'));
    const rec = join(dir, 'raw', '1-anna.b.rec');
    const partial = encodeRecord({
      arrival: 2000,
      seq: 0,
      rtpTimestamp: 0,
      hasRtp: false,
      payload: frame(2),
    });
    writeFileSync(rec, Buffer.concat([readFileSync(rec), partial.subarray(0, 7)]));
    writeFileSync(
      join(dir, 'speakers.json'),
      '{"anna.b":{"player":"Anna","character":"Ireena"}}\n'
    );

    const result = convertSession(dir);
    expect(result.speakersWritten).toBe(false);
    expect(result.tracks[0]).toMatchObject({ truncatedBytes: 7, stats: { packets: 1 } });
    expect(readFileSync(join(dir, 'speakers.json'), 'utf8')).toContain('Ireena');
  });

  it('ignores packets after stop', async () => {
    const dir = tempDir();
    const s = new RecordingSession(dir, fakeClock());
    await s.stop('test');
    s.packet(anna, frame(1), undefined);
    expect(s.summaries()).toEqual([]);
  });
});
