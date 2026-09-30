/**
 * Turn a recording session's `raw/` folder into the layout the transcriber reads:
 * `<session>/<n>-<username>.ogg` (Craig naming), every track starting at session start, plus a
 * `speakers.json` for the session pipeline (kept if one already exists, so hand edits survive)
 * and `raw/convert-report.json` with the numbers worth checking.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeTrack } from '../rec/format.js';
import type { TrackSummary } from '../rec/session.js';
import { OggOpusWriter } from './ogg.js';
import { buildTimeline, type TimelineStats } from './timeline.js';

export interface ConvertedTrack {
  file: string;
  userId: string;
  track: number;
  seconds: number;
  truncatedBytes: number;
  stats: TimelineStats;
}

export interface ConvertResult {
  dir: string;
  tracks: ConvertedTrack[];
  speakersWritten: boolean;
}

interface SessionJson {
  tracks?: TrackSummary[];
}

function readSessionJson(rawDir: string): SessionJson {
  const p = join(rawDir, 'session.json');
  if (!existsSync(p)) return {}; // a crashed session: the .rec headers still carry the ids
  return JSON.parse(readFileSync(p, 'utf8')) as SessionJson;
}

export function convertSession(dir: string): ConvertResult {
  const rawDir = join(dir, 'raw');
  if (!existsSync(rawDir)) throw new Error(`No raw/ folder in ${dir}`);
  const session = readSessionJson(rawDir);
  const byUser = new Map((session.tracks ?? []).map(t => [t.userId, t]));

  const recFiles = readdirSync(rawDir)
    .filter(f => f.endsWith('.rec'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const tracks: ConvertedTrack[] = [];
  const speakers: Record<string, { player: string }> = {};
  for (const recFile of recFiles) {
    const decoded = decodeTrack(readFileSync(join(rawDir, recFile)));
    const stem = basename(recFile, '.rec');
    const writer = new OggOpusWriter(decoded.header.track, 2, [
      `DISCORD_USER_ID=${decoded.header.userId}`,
      `SESSION_START=${decoded.header.sessionStart}`,
    ]);
    const stats = buildTimeline(decoded.records, p => writer.write(p.packet, p.samples));
    const file = `${stem}.ogg`;
    writeFileSync(join(dir, file), writer.finish());

    const info = byUser.get(decoded.header.userId);
    // The transcriber names a Craig track `1-anna` as speaker `anna`; key speakers.json the same.
    const speakerId = stem.replace(/^\d+-/, '');
    speakers[speakerId] = { player: info?.displayName ?? speakerId };
    tracks.push({
      file,
      userId: decoded.header.userId,
      track: decoded.header.track,
      seconds: Math.round(stats.endSamples / 480) / 100,
      truncatedBytes: decoded.truncatedBytes,
      stats,
    });
  }

  const speakersPath = join(dir, 'speakers.json');
  const speakersWritten = !existsSync(speakersPath);
  if (speakersWritten) writeFileSync(speakersPath, `${JSON.stringify(speakers, null, 2)}\n`);
  writeFileSync(
    join(rawDir, 'convert-report.json'),
    `${JSON.stringify({ convertedAt: new Date().toISOString(), tracks }, null, 2)}\n`
  );
  return { dir, tracks, speakersWritten };
}
