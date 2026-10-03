/**
 * `discord-bot rehearse <folder>`: test the recorder without people. Speaker bots play known
 * per-speaker tracks into the rehearsal voice channel, sending only while their speaker talks
 * (like a Discord client), while the recorder records in the same process. Halfway through, the
 * recorder's connection is dropped once to test the rejoin. Afterwards the recording is
 * converted as usual and every recorded track is lined up against its source, because the play
 * start is known on the recorder's own clock.
 */

import { ChannelType, Client, GatewayIntentBits } from 'discord.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFolderName } from '../bot.js';
import type { BotConfig, RehearsalConfig } from '../config.js';
import { convertSession } from '../convert/convert.js';
import * as log from '../log.js';
import { RecordingSession, type Clock, type SpeakerInfo } from '../rec/session.js';
import { VoiceRecorder } from '../rec/voice.js';
import { alignWindows, decodeMono16k, envelope, spread, type Spread } from './compare.js';
import { listSources, prepareSource, type Source } from './source.js';
import { SpeakerBot } from './speaker.js';

export interface RehearseOptions {
  sourceDir: string;
  /** Play this many seconds (0: the shortest chosen source). */
  seconds: number;
  /** Drop the recorder's connection at this many seconds (negative: never; default: halfway). */
  dropAtS: number | undefined;
  /** Seconds to wait after everyone joined, so the voice encryption group settles. */
  settleS: number;
}

export interface SpeakerReport {
  speaker: string;
  bot: string;
  source: string;
  sentFrames: number;
  failedSends: number;
  recordedPackets: number;
  framesSentWhileAway: number;
  lossOutsideGapPct: number;
  sendLateP95Ms: number;
  alignment: Spread | null;
  track: string | null;
}

export interface RehearsalReport {
  folder: string;
  playedSeconds: number;
  dropAtS: number | null;
  awaySeconds: number | null;
  interTrackSpreadMs: number | null;
  speakers: SpeakerReport[];
  verdict: 'pass' | 'check';
  reasons: string[];
}

const FRAME_NS = 20_000_000n;

function startClock(): { clock: Clock; startNs: bigint } {
  const startNs = process.hrtime.bigint();
  return {
    startNs,
    clock: { now: () => Number(((process.hrtime.bigint() - startNs) * 6n) / 125_000n) },
  };
}

/** Wait until `targetNs` on the hrtime clock: a coarse timer, then a short spin for precision. */
async function waitUntil(targetNs: bigint): Promise<void> {
  for (;;) {
    const left = Number(targetNs - process.hrtime.bigint()) / 1e6;
    if (left <= 0) return;
    if (left > 20)
      await new Promise(r => setTimeout(r, left - 17)); // Windows timers are coarse
    else await new Promise(r => setImmediate(r));
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

interface EventLine {
  t: number;
  type: string;
}

function readEvents(folder: string): EventLine[] {
  return readFileSync(join(folder, 'raw', 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as EventLine);
}

export async function rehearse(
  bot: BotConfig,
  cfg: RehearsalConfig,
  opts: RehearseOptions
): Promise<RehearsalReport> {
  const folder = join(cfg.dir, sessionFolderName(new Date()).replace(/-discord$/, '-rehearsal'));
  mkdirSync(folder, { recursive: true });

  // 1. Sources: the busiest tracks, one per speaker bot, cut to a common length.
  const files = listSources(opts.sourceDir);
  if (files.length === 0) throw new Error(`No audio files in ${opts.sourceDir}`);
  log.info(`Preparing ${files.length} source track(s)...`);
  // Prepared copies go to a temp folder, never into the recording: the transcriber reads every
  // audio file under the session folder.
  const workDir = mkdtempSync(join(tmpdir(), 'fvtt-rehearsal-'));
  let prepared: Source[];
  try {
    prepared = files.map(f => prepareSource(f, workDir, opts.seconds));
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true });
    throw err;
  }
  const sources: Source[] = prepared
    .sort((a, b) => b.sendFrames - a.sendFrames)
    .slice(0, cfg.speakerTokens.length);
  const frames = Math.min(...sources.map(s => s.packets.length));
  const playedSeconds = frames * 0.02;
  const dropAtS =
    opts.dropAtS === undefined ? playedSeconds / 2 : opts.dropAtS < 0 ? null : opts.dropAtS;
  for (const s of sources) {
    log.info(`  ${s.name}: ${Math.round((s.sendFrames / s.packets.length) * 100)} % speech`);
  }

  // 2. The recorder, in this process, on a clock whose start we know.
  const recorderClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  const speakers = sources.map((_, i) => new SpeakerBot(i + 1, cfg.speakerTokens[i]));
  let recorder: VoiceRecorder | undefined;
  let session: RecordingSession | undefined;
  try {
    await recorderClient.login(bot.token);
    await new Promise<void>(r =>
      recorderClient.isReady() ? r() : recorderClient.once('clientReady', () => r())
    );
    const channel = await recorderClient.channels.fetch(cfg.channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error(`REHEARSAL_CHANNEL_ID ${cfg.channelId} is not a voice channel`);
    }
    const { clock, startNs } = startClock();
    session = new RecordingSession(folder, clock, {
      guildId: channel.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      rehearsal: true,
    });
    const guild = channel.guild;
    recorder = new VoiceRecorder({
      target: {
        guildId: guild.id,
        channelId: channel.id,
        adapterCreator: guild.voiceAdapterCreator,
      },
      session,
      resolveSpeaker: (userId): SpeakerInfo => {
        const user = recorderClient.users.cache.get(userId);
        const name = user?.username ?? userId;
        return { userId, username: name, displayName: user?.globalName ?? name };
      },
      alert: msg => log.info(`  recorder: ${msg}`),
    });
    log.info(`Recorder joining ${channel.name}...`);
    await recorder.start();

    // 3. Speaker bots join.
    await Promise.all(speakers.map(s => s.login()));
    await Promise.all(speakers.map(s => s.join(cfg.channelId)));
    speakers.forEach((s, i) => log.info(`  ${s.username} plays ${sources[i].name}`));
    log.info(`Settling for ${opts.settleS} s...`);
    await new Promise(r => setTimeout(r, opts.settleS * 1000));

    // 4. Play. One scheduler for all bots: frame i of every source goes out at t0 + i * 20 ms.
    const t0 = process.hrtime.bigint() + 500_000_000n;
    const offsetS = Number(t0 - startNs) / 1e9;
    session.log({ type: 'rehearsal_play', offsetS, frames, speakers: speakers.map(s => s.userId) });
    const last = speakers.map(() => -1);
    const sentAt: number[][] = speakers.map(() => []); // send times, seconds on the recorder clock
    const failed = speakers.map(() => 0);
    const late: number[] = [];
    const dropFrame = dropAtS === null ? -1 : Math.round(dropAtS / 0.02);
    log.info(
      `Playing ${Math.round(playedSeconds)} s${dropAtS === null ? '' : `, dropping the recorder at ${Math.round(dropAtS)} s`}...`
    );
    for (let i = 0; i < frames; i++) {
      const target = t0 + BigInt(i) * FRAME_NS;
      await waitUntil(target);
      const now = process.hrtime.bigint();
      if (i === dropFrame) recorder.simulateDrop();
      speakers.forEach((s, k) => {
        const src = sources[k];
        if (src.send[i]) {
          if (last[k] >= 0 && last[k] < i - 1) s.skip(i - 1 - last[k]);
          if (s.send(src.packets[i])) sentAt[k].push(Number(now - startNs) / 1e9);
          else failed[k]++;
          last[k] = i;
        } else if (last[k] === i - 1) {
          s.pause();
        }
      });
      late.push(Number(process.hrtime.bigint() - target) / 1e6);
      if (i > 0 && i % 3000 === 0) log.info(`  ${Math.round(i * 0.02)} s`);
    }
    speakers.forEach(s => s.pause());
    await new Promise(r => setTimeout(r, 1500));

    // 5. Stop, convert, compare.
    recorder.stop();
    const tracks = await session.stop('rehearsal end');
    log.info('Converting...');
    const converted = convertSession(folder);
    const events = readEvents(folder);
    const dropT = events.find(e => e.type === 'simulated_drop')?.t;
    const backT = events.find(e => e.type === 'rejoined')?.t;
    const away =
      dropT !== undefined ? [dropT / 48000, backT !== undefined ? backT / 48000 : Infinity] : null;

    log.info('Lining up the recorded tracks with their sources...');
    const reports: SpeakerReport[] = speakers.map((s, k) => {
      const src = sources[k];
      const track = converted.tracks.find(t => t.userId === s.userId);
      const summary = tracks.find(t => t.userId === s.userId);
      const times = sentAt[k];
      const whileAway = away ? times.filter(t => t >= away[0] && t <= away[1]).length : 0;
      const expected = times.length - whileAway;
      const recordedPackets = summary?.packets ?? 0;
      const loss = expected > 0 ? Math.max(0, (expected - recordedPackets) / expected) : 0;
      let alignment: Spread | undefined;
      if (track) {
        const srcEnv = envelope(decodeMono16k(src.file, playedSeconds));
        const recEnv = envelope(decodeMono16k(join(folder, track.file)));
        alignment = spread(alignWindows(srcEnv, recEnv, offsetS));
      }
      return {
        speaker: src.name,
        bot: s.username,
        source: src.file,
        sentFrames: times.length,
        failedSends: failed[k],
        recordedPackets,
        framesSentWhileAway: whileAway,
        lossOutsideGapPct: Math.round(loss * 1000) / 10,
        sendLateP95Ms: Math.round(percentile(late, 0.95) * 10) / 10,
        alignment: alignment ?? null,
        track: track?.file ?? null,
      };
    });

    const medians = reports.flatMap(r => (r.alignment ? [r.alignment.medianMs] : []));
    const interTrack = medians.length > 1 ? Math.max(...medians) - Math.min(...medians) : null;
    const reasons: string[] = [];
    for (const r of reports) {
      if (!r.track) reasons.push(`${r.speaker}: no recorded track`);
      else if (!r.alignment) reasons.push(`${r.speaker}: could not line up the track`);
      else if (r.alignment.p95SpreadMs > 40)
        reasons.push(`${r.speaker}: alignment wanders ${r.alignment.p95SpreadMs} ms (p95)`);
      if (r.lossOutsideGapPct > 1)
        reasons.push(`${r.speaker}: ${r.lossOutsideGapPct} % packets lost`);
    }
    if (interTrack !== null && interTrack > 40)
      reasons.push(`tracks are ${Math.round(interTrack)} ms apart from each other`);
    if (dropAtS !== null && backT === undefined) reasons.push('the recorder did not rejoin');
    const report: RehearsalReport = {
      folder,
      playedSeconds: Math.round(playedSeconds),
      dropAtS: dropAtS === null ? null : Math.round(dropAtS),
      awaySeconds:
        away && Number.isFinite(away[1]) ? Math.round((away[1] - away[0]) * 10) / 10 : null,
      interTrackSpreadMs: interTrack === null ? null : Math.round(interTrack * 10) / 10,
      speakers: reports,
      verdict: reasons.length === 0 ? 'pass' : 'check',
      reasons,
    };
    writeFileSync(join(folder, 'rehearsal.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    recorder?.stop();
    if (session && !session.isStopped) await session.stop('rehearsal aborted');
    await Promise.allSettled(speakers.map(s => s.destroy()));
    await recorderClient.destroy();
  }
}
