/**
 * The Discord bot, recorder part: `/record start | stop | status`.
 *
 * `start` joins the caller's voice channel and posts a recording notice there; `stop` leaves,
 * converts the session and replies with a short summary. Only one recording runs at a time.
 * The command is limited to members with Manage Server by default (the server owner can change
 * that under Server Settings > Integrations).
 */

import type { Server } from 'node:http';

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type VoiceBasedChannel,
} from 'discord.js';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STATUS_HOST, type BotConfig } from './config.js';
import * as log from './log.js';
import { convertSession } from './convert/convert.js';
import { RecordingSession, hrtimeClock, type SpeakerInfo } from './rec/session.js';
import { VoiceRecorder } from './rec/voice.js';
import { RecorderHealth } from './rec/health.js';
import { startStatusServer } from './status-server.js';
import { bi, da, plural } from './i18n.js';
import { alertTarget, isMuted, statusText, voiceAction } from './bot-health.js';
import {
  claimOnReady,
  destroyThenClear,
  markerPath,
  restartAfterCrashMessage,
} from './run-marker.js';
import { recoverMessage, recoverOrphans } from './rec/recover.js';
import {
  SPACE_CHECK_INTERVAL_MS,
  LogThrottle,
  SpaceNotifier,
  resolveOwnerId,
  type ApplicationOwnerLike,
} from './space-notify.js';
import { createSpaceStatusReader } from './space-status.js';
import { DEFAULT_BACKUP_STALE_DAYS, createBackupPullReader } from './backup-pull-status.js';
import { BackupPullNotifier } from './backup-pull-notify.js';
import {
  SESSION_POST_INTERVAL_MS,
  SessionPostNotifier,
  createSessionFlagReader,
} from './session-post.js';

export const RECORD_COMMAND = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Record the voice channel, one track per speaker')
  .setDescriptionLocalizations(da('Optag voice channel, ét spor pr. person'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s =>
    s
      .setName('start')
      .setDescription('Join your voice channel and record')
      .setDescriptionLocalizations(da('Kom ind i din voice channel og optag'))
  )
  .addSubcommand(s =>
    s
      .setName('stop')
      .setDescription('Stop recording and prepare the audio')
      .setDescriptionLocalizations(da('Stop optagelsen og gør lyden klar'))
  )
  .addSubcommand(s =>
    s
      .setName('status')
      .setDescription('Show what is being recorded')
      .setDescriptionLocalizations(da('Vis, hvad der bliver optaget'))
  );

const NOTICE = bi(
  'Optagelsen er startet: denne voice channel bliver optaget, ét spor pr. person, til session notes. ' +
    'Dit spor ligger på arrangørens pc, også som træningsdata, indtil du beder om at få det slettet.',
  'Recording started: this voice channel is recorded, one track per person, for the session ' +
    "notes. Your track is kept on the organiser's PC, also as training data, until you ask to " +
    'have it deleted.'
);
const NOT_RECORDING = bi('Der optages ikke.', 'Not recording.');

interface Active {
  session: RecordingSession;
  recorder: VoiceRecorder;
  channel: VoiceBasedChannel;
  health: RecorderHealth;
  healthTimer: NodeJS.Timeout;
}

/** How often the recorder checks for members it has heard nothing from. */
export const HEALTH_CHECK_INTERVAL_MS = 30_000;

/** `2026-10-04_1930-discord` in local time. */
export function sessionFolderName(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}-discord`;
}

/** A folder under `sessionsDir` that does not exist yet: the base name, then `-2`, `-3` and so on. */
export function uniqueSessionDir(sessionsDir: string, d: Date): string {
  const base = sessionFolderName(d);
  let name = base;
  for (let n = 2; existsSync(join(sessionsDir, name)); n++) name = `${base}-${n}`;
  return join(sessionsDir, name);
}

/** The public reply to `/record stop`: tracks and minutes only, no paths or packet counts. */
export function stopSummary(trackSeconds: number[], incomplete: boolean): string {
  const minutes = Math.max(1, Math.round(Math.max(0, ...trackSeconds) / 60));
  const n = trackSeconds.length;
  const daText = `Optagelsen er stoppet og gemt: ${n} spor, cirka ${minutes} ${plural(minutes, 'minut', 'minutter')}.`;
  const enText = `Recording stopped and saved: ${n} ${plural(n, 'track', 'tracks')}, about ${minutes} ${plural(minutes, 'minute', 'minutes')}.`;
  return incomplete
    ? bi(
        `${daText} Dele af optagelsen mangler måske. Sig det til ejeren før næste session.`,
        `${enText} Part of the recording may be missing. Tell the owner before the next session.`
      )
    : bi(daText, enText);
}

export class RecorderBot {
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  private active: Active | undefined;
  private spaceTimer: NodeJS.Timeout | undefined;
  private sessionPostTimer: NodeJS.Timeout | undefined;
  private statusServer: Server | undefined;
  /** DM to the owner; set once the owner is known. */
  private notifyOwner: ((text: string) => Promise<boolean>) | undefined;

  private readonly alertFailureLog = new LogThrottle();
  private crashNotice: string | null = null;

  constructor(private readonly config: BotConfig) {}

  /**
   * Post to the GM channel (DISCORD_GM_BOT_CHANNEL_ID, else GAMENIGHT_WATCH_CHANNEL_ID), or to
   * `fallback` (the voice channel) when none is set or the post fails. A failure is logged at most
   * once per 24 hours.
   */
  async alertGm(text: string, fallback?: VoiceBasedChannel): Promise<void> {
    const id = this.config.gmBotChannelId;
    const tryChannel = async (target: { send(t: string): Promise<unknown> }): Promise<void> => {
      await target.send(text);
      this.alertFailureLog.reset();
    };
    try {
      const target = alertTarget(id, Boolean(fallback));
      if (target === 'gm' && id) {
        const ch = await this.client.channels.fetch(id);
        if (!ch?.isSendable()) throw new Error('not a channel the bot can post in');
        await tryChannel(ch);
        return;
      }
      if (target === 'fallback' && fallback) {
        await tryChannel(fallback);
        return;
      }
      throw new Error('no GM channel configured (DISCORD_GM_BOT_CHANNEL_ID)');
    } catch (err) {
      if (this.alertFailureLog.shouldLog()) {
        log.error(
          `Could not post a recorder alert (logged at most once per 24 hours): ${text}`,
          err
        );
      }
      if (id && fallback) {
        try {
          await fallback.send(text);
        } catch {
          // already logged above
        }
      }
    }
  }

  async run(): Promise<void> {
    this.client.on('error', err => log.error('Discord client error', err));
    // Registered before the handler below, so the notice is set when it reads it.
    claimOnReady(
      cb => this.client.once('clientReady', () => cb()),
      markerPath(this.config.sessionsDir),
      previous => (this.crashNotice = previous)
    );
    this.client.once('clientReady', c => {
      log.info(`Logged in as ${c.user.tag}`);
      if (this.crashNotice) {
        const text = restartAfterCrashMessage(this.crashNotice);
        log.info(text);
        void this.alertGm(text);
      }
      const body = [RECORD_COMMAND.toJSON()];
      const guildId = this.config.guildId;
      const registered = guildId
        ? c.application.commands.set(body, guildId).then(() => `in server ${guildId}`)
        : c.application.commands.set(body).then(() => 'globally (can take up to an hour to show)');
      registered.then(
        where => log.info(`Registered /record ${where}`),
        (err: unknown) => log.error('Registering /record failed', err)
      );
      this.startSessionPost(c);
      void this.startSpaceNotices(c)
        .catch((err: unknown) => log.error('Space notices could not start', err))
        .then(() => this.recoverOrphans());
    });
    this.client.on('interactionCreate', i => {
      if (i.isChatInputCommand() && i.commandName === 'record') {
        this.onRecord(i).catch((err: unknown) => log.error('record command failed', err));
      }
    });
    this.client.on('voiceStateUpdate', (before, after) => {
      const a = this.active;
      if (!a) return;
      const id = after.id;
      const human = !after.member?.user.bot;
      const muted = isMuted(after);
      const action = voiceAction(before, after, a.channel.id);
      if (action === 'join') {
        a.session.log({ type: 'join', userId: id, username: after.member?.user.username });
        if (human) a.health.join(id, after.member?.displayName ?? id, muted, Date.now());
      } else if (action === 'leave') {
        a.session.log({ type: 'leave', userId: id });
        a.health.leave(id);
      } else if (action === 'mute-change' && human) {
        a.health.setMuted(id, muted, Date.now());
      }
    });
    this.startStatusEndpoint();
    await this.client.login(this.config.token);
  }

  /** The dashboard health line's read-only status endpoint (status-server.ts), when configured. */
  private startStatusEndpoint(): void {
    const port = this.config.statusPort;
    if (port === undefined) {
      if (this.config.statusPortRaw) {
        log.error(
          `FOUNDRY_AI_BOT_STATUS_PORT is "${this.config.statusPortRaw}", not a port from 1 to 65535: the status endpoint stays off, and the Recorder dot will show unknown.`
        );
      }
      return;
    }
    const host = this.config.statusHost ?? DEFAULT_STATUS_HOST;
    this.statusServer = startStatusServer(
      host,
      port,
      () => ({
        recording: this.active !== undefined,
        problems: this.active?.health.problems(Date.now()) ?? [],
      }),
      err =>
        log.error(
          (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? `Status endpoint: port ${port} on ${host} is already in use, so the endpoint is NOT running and the Recorder dot will show unknown. Change FOUNDRY_AI_BOT_STATUS_PORT.`
            : 'Status endpoint error',
          err
        )
    );
    log.info(`Status endpoint: http://${host}:${port}/status`);
  }

  /**
   * Notices by DM to the owner, every 15 minutes: storage space (space-notify.ts, from the Pi's
   * status file) and stale backup copies on the PC (backup-pull-notify.ts, from the Pi's record of
   * the PC's last pulls). The owner is DISCORD_OWNER_ID, else the Discord application's owner.
   */
  private async startSpaceNotices(c: Client<true>): Promise<void> {
    const app = await c.application.fetch();
    const owner = app.owner as ApplicationOwnerLike | null;
    const ownerId = resolveOwnerId(this.config.ownerId, owner);
    if (!ownerId) {
      log.info(
        'Space notices: no owner user found (a team owner id is needed), so storage space DMs are off. Set DISCORD_OWNER_ID in the bot settings to turn them on.'
      );
      return;
    }
    const readStatus = createSpaceStatusReader({
      ...(this.config.spaceStatusFile ? { path: this.config.spaceStatusFile } : {}),
      log: log.info,
    });
    const dmFailureLog = new LogThrottle();
    const send = async (text: string): Promise<boolean> => {
      try {
        const user = await c.users.fetch(ownerId);
        await user.send(text);
        dmFailureLog.reset();
        return true;
      } catch (err) {
        if (dmFailureLog.shouldLog()) {
          log.error(
            'Notices: the DM to the owner failed (will retry; logged at most once per 24 hours)',
            err
          );
        }
        return false;
      }
    };
    this.notifyOwner = send;
    const notifier = new SpaceNotifier({ send });
    const readPulls = createBackupPullReader({
      ...(this.config.backupPullsDir ? { dir: this.config.backupPullsDir } : {}),
      ...(this.config.backupStaleDays ? { staleDays: this.config.backupStaleDays } : {}),
      log: log.info,
    });
    const pullNotifier = new BackupPullNotifier({ send });
    const tick = (withBackupCheck: boolean): void => {
      notifier.check(readStatus()).catch((err: unknown) => log.error('Space check failed', err));
      if (!withBackupCheck) return;
      pullNotifier
        .check(readPulls())
        .catch((err: unknown) => log.error('Backup copy check failed', err));
    };
    // The first backup check waits one interval: the notice state lives in memory, so a restart (or a
    // crash loop) would otherwise repeat the stale DM at every start. The space check runs at once.
    tick(false);
    this.spaceTimer = setInterval(() => tick(true), SPACE_CHECK_INTERVAL_MS);
    this.spaceTimer.unref();
    log.info(
      `Space and backup copy notices: checking every ${SPACE_CHECK_INTERVAL_MS / 60000} minutes (backup copies are stale after ${this.config.backupStaleDays ?? DEFAULT_BACKUP_STALE_DAYS} days).`
    );
  }

  /**
   * I-111: when a play session ends, post a link to the player page in the configured channel
   * (session-post.ts). Off unless DISCORD_SESSION_POST_CHANNEL_ID is set.
   */
  private startSessionPost(c: Client<true>): void {
    const channelId = this.config.sessionPostChannelId;
    if (!channelId) return;
    const dashboardUrl = this.config.dashboardUrl ?? 'http://127.0.0.1:3100';
    const pageUrl = this.config.playerPageUrl;
    if (!pageUrl) {
      log.info(
        'Session post: off, because FOUNDRY_AI_PLAYER_PAGE_URL is not set (the link players can open).'
      );
      return;
    }
    const read = createSessionFlagReader({
      dashboardUrl,
      token: this.config.playerToken,
      log: log.info,
    });
    const failureLog = new LogThrottle();
    const notifier = new SessionPostNotifier({
      pageUrl,
      send: async (text): Promise<boolean> => {
        try {
          const channel = await c.channels.fetch(channelId);
          if (!channel?.isSendable()) throw new Error('not a channel the bot can post in');
          await channel.send(text);
          failureLog.reset();
          return true;
        } catch (err) {
          if (failureLog.shouldLog()) {
            log.error(
              'Session post: could not post in the channel (will retry; logged at most once per 24 hours)',
              err
            );
          }
          return false;
        }
      },
    });
    const tick = (): void => {
      void read()
        .then(flag => notifier.check(flag))
        .catch((err: unknown) => log.error('Session post check failed', err));
    };
    tick();
    this.sessionPostTimer = setInterval(tick, SESSION_POST_INTERVAL_MS);
    this.sessionPostTimer.unref();
    log.info(
      `Session post: on, checking ${dashboardUrl} every ${SESSION_POST_INTERVAL_MS / 60000} minutes.`
    );
  }

  /** Convert raw recordings a crashed run left behind and tell the owner (or the log). */
  private async recoverOrphans(): Promise<void> {
    try {
      const outcomes = await recoverOrphans(this.config.sessionsDir, {
        isActive: dir => this.active?.session.dir === dir,
      });
      const text = recoverMessage(outcomes);
      if (!text) return;
      log.info(text);
      if (this.notifyOwner) await this.notifyOwner(text);
    } catch (err) {
      log.error('Looking for unconverted recordings failed', err);
    }
  }

  /**
   * A recording file could not be written (disk full, no permission): log every one, but tell the
   * channel and the owner only once per recording (`told` is that recording's flag).
   */
  private onStreamError(
    channel: VoiceBasedChannel,
    told: { value: boolean },
    what: string,
    err: Error
  ): void {
    const detail = `Recording problem: ${what} could not be written (${err.message}). Check the disk space on the recorder host; other files of this recording may be affected too.`;
    log.error(detail, err);
    const daDetail = `Optageproblem: ${what} kunne ikke skrives (${err.message}). Tjek diskpladsen på recorder-værten; andre filer i optagelsen kan også være ramt.`;
    if (told.value) return;
    told.value = true;
    const text = bi(
      'Optageproblem: en del af optagelsen kunne ikke gemmes. Sig det til ejeren, som skal tjekke diskpladsen på recorder-værten.',
      'Recording problem: part of the recording could not be saved. Tell the owner, who should check the disk space on the recorder host.'
    );
    void this.alertGm(text, channel);
    if (this.notifyOwner) void this.notifyOwner(bi(daDetail, detail));
  }

  private speakerResolver(guild: Guild): (userId: string) => SpeakerInfo {
    return userId => {
      const member = guild.members.cache.get(userId);
      const user = member?.user ?? this.client.users.cache.get(userId);
      return {
        userId,
        username: user?.username ?? userId,
        displayName: member?.displayName ?? user?.globalName ?? user?.username ?? userId,
      };
    };
  }

  private async onRecord(i: ChatInputCommandInteraction): Promise<void> {
    const sub = i.options.getSubcommand();
    if (sub === 'status') {
      const a = this.active;
      const text = a
        ? statusText(
            a.channel.name,
            a.session.summaries().length,
            a.recorder.rtpTapActive,
            a.recorder.connectionStatus,
            a.health.speakerLines(Date.now())
          )
        : NOT_RECORDING;
      await i.reply({ content: text, flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'stop') {
      if (!this.active) {
        await i.reply({ content: NOT_RECORDING, flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferReply();
      const summary = await this.stop('command');
      await i.editReply(summary);
      return;
    }
    // start
    if (this.active) {
      await i.reply({
        content: bi(
          `Der optages allerede i ${this.active.channel.name}.`,
          `Already recording in ${this.active.channel.name}.`
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guild = i.guild;
    const member = guild ? await guild.members.fetch(i.user.id) : undefined;
    const channel = member?.voice.channel;
    if (!guild || channel?.type !== ChannelType.GuildVoice) {
      await i.reply({
        content: bi('Kom ind i en voice channel først.', 'Join a voice channel first.'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.deferReply();
    mkdirSync(this.config.sessionsDir, { recursive: true });
    const dir = uniqueSessionDir(this.config.sessionsDir, new Date());
    mkdirSync(dir);
    const told = { value: false };
    const session = new RecordingSession(
      dir,
      hrtimeClock(),
      {
        guildId: guild.id,
        channelId: channel.id,
        channelName: channel.name,
        startedBy: i.user.id,
      },
      new Date(),
      (what, err) => this.onStreamError(channel, told, what, err)
    );
    for (const [id, m] of channel.members) {
      session.log({ type: 'present', userId: id, username: m.user.username, bot: m.user.bot });
    }
    const health = new RecorderHealth();
    const startedAt = Date.now();
    for (const [id, m] of channel.members) {
      if (!m.user.bot) {
        health.join(id, m.displayName, Boolean(m.voice.selfMute || m.voice.serverMute), startedAt);
      }
    }
    const healthTimer = setInterval(() => {
      // `recorder` is assigned below, before the first tick.
      const up = recorder.connectionStatus === 'ready';
      for (const line of health.silent(Date.now(), up)) void this.alertGm(line, channel);
    }, HEALTH_CHECK_INTERVAL_MS);
    healthTimer.unref();
    const recorder = new VoiceRecorder({
      target: {
        guildId: guild.id,
        channelId: channel.id,
        adapterCreator: guild.voiceAdapterCreator,
      },
      session,
      resolveSpeaker: this.speakerResolver(guild),
      alert: (msg): void => void this.alertGm(msg, channel),
      health,
    });
    this.active = { session, recorder, channel, health, healthTimer };
    try {
      await recorder.start();
    } catch (err) {
      log.error(`Could not join ${channel.name}`, err);
      await this.stop('join failed');
      await i.editReply(
        bi(
          `Kunne ikke komme ind i ${channel.name}. Tjek, at botten må komme ind i den channel, og prøv /record start igen.`,
          `Could not join ${channel.name}. Check that the bot may join that channel, then try /record start again.`
        )
      );
      return;
    }
    await i.editReply(NOTICE);
  }

  /** Stop the active recording, convert it and return a short summary. */
  async stop(reason: string): Promise<string> {
    const a = this.active;
    if (!a) return NOT_RECORDING;
    this.active = undefined;
    clearInterval(a.healthTimer);
    a.recorder.stop();
    const tracks = await a.session.stop(reason);
    if (tracks.length === 0)
      return bi(
        'Optagelsen er stoppet. Ingen sagde noget, så der er intet at konvertere.',
        'Recording stopped. Nobody spoke, so there is nothing to convert.'
      );
    try {
      const result = convertSession(a.session.dir);
      // Paths, packet counts and per-file detail stay in the log; the channel gets the short form.
      log.info(
        `Recording converted (${a.session.dir}): ${result.tracks
          .map(
            t =>
              `${t.file}: ${Math.round(t.seconds / 60)} min, ${t.stats.packets} packets${
                t.stats.droppedDave ? `, ${t.stats.droppedDave} undecrypted dropped` : ''
              }`
          )
          .join('; ')}`
      );
      const failed = a.session.failedFiles;
      if (failed.length) log.error(`Files that could not be written: ${failed.join(', ')}`);
      return stopSummary(
        result.tracks.map(t => t.seconds),
        failed.length > 0
      );
    } catch (err) {
      log.error(`Converting the recording failed; raw files kept in ${a.session.dir}`, err);
      return bi(
        'Optagelsen er stoppet, men lyden kunne ikke gøres klar. Råfilerne er gemt. Bed ejeren se i recorder-loggen.',
        'Recording stopped, but the audio could not be prepared. The raw files are kept. Ask the owner to look at the recorder log.'
      );
    }
  }

  async shutdown(): Promise<void> {
    if (this.spaceTimer) clearInterval(this.spaceTimer);
    if (this.sessionPostTimer) clearInterval(this.sessionPostTimer);
    this.statusServer?.close();
    if (this.active) log.info(await this.stop('shutdown'));
    await destroyThenClear(() => this.client.destroy(), markerPath(this.config.sessionsDir));
  }
}
