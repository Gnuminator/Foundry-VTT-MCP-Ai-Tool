/**
 * The Discord bot, recorder part: `/record start | stop | status`.
 *
 * `start` joins the caller's voice channel and posts a recording notice there; `stop` leaves,
 * converts the session and replies with a short summary. Only one recording runs at a time.
 * The command is limited to members with Manage Server by default (the server owner can change
 * that under Server Settings > Integrations).
 */

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
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig } from './config.js';
import * as log from './log.js';
import { convertSession } from './convert/convert.js';
import { RecordingSession, hrtimeClock, type SpeakerInfo } from './rec/session.js';
import { VoiceRecorder } from './rec/voice.js';
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

export const RECORD_COMMAND = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Record the voice channel, one track per speaker')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s.setName('start').setDescription('Join your voice channel and record'))
  .addSubcommand(s => s.setName('stop').setDescription('Stop recording and prepare the audio'))
  .addSubcommand(s => s.setName('status').setDescription('Show what is being recorded'));

const NOTICE =
  'Recording started: this voice channel is recorded, one track per person, for the session ' +
  "notes. Your track is kept on the organiser's PC, also as training data, until you ask to " +
  'have it deleted.';

interface Active {
  session: RecordingSession;
  recorder: VoiceRecorder;
  channel: VoiceBasedChannel;
}

/** `2026-10-04_1930-discord` in local time. */
export function sessionFolderName(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}-discord`;
}

export class RecorderBot {
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  private active: Active | undefined;
  private spaceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: BotConfig) {}

  async run(): Promise<void> {
    this.client.once('clientReady', c => {
      log.info(`Logged in as ${c.user.tag}`);
      const body = [RECORD_COMMAND.toJSON()];
      const guildId = this.config.guildId;
      const registered = guildId
        ? c.application.commands.set(body, guildId).then(() => `in server ${guildId}`)
        : c.application.commands.set(body).then(() => 'globally (can take up to an hour to show)');
      registered.then(
        where => log.info(`Registered /record ${where}`),
        (err: unknown) => log.error('Registering /record failed', err)
      );
      void this.startSpaceNotices(c).catch((err: unknown) =>
        log.error('Space notices could not start', err)
      );
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
      if (before.channelId !== a.channel.id && after.channelId === a.channel.id) {
        a.session.log({ type: 'join', userId: id, username: after.member?.user.username });
      } else if (before.channelId === a.channel.id && after.channelId !== a.channel.id) {
        a.session.log({ type: 'leave', userId: id });
      }
    });
    await this.client.login(this.config.token);
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
        ? `Recording in ${a.channel.name}: ${a.session.summaries().length} track(s), RTP tap ${a.recorder.rtpTapActive ? 'on' : 'off'}.`
        : 'Not recording.';
      await i.reply({ content: text, flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === 'stop') {
      if (!this.active) {
        await i.reply({ content: 'Not recording.', flags: MessageFlags.Ephemeral });
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
        content: `Already recording in ${this.active.channel.name}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guild = i.guild;
    const member = guild ? await guild.members.fetch(i.user.id) : undefined;
    const channel = member?.voice.channel;
    if (!guild || channel?.type !== ChannelType.GuildVoice) {
      await i.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply();
    const dir = join(this.config.sessionsDir, sessionFolderName(new Date()));
    mkdirSync(dir, { recursive: true });
    const session = new RecordingSession(dir, hrtimeClock(), {
      guildId: guild.id,
      channelId: channel.id,
      channelName: channel.name,
      startedBy: i.user.id,
    });
    for (const [id, m] of channel.members) {
      session.log({ type: 'present', userId: id, username: m.user.username, bot: m.user.bot });
    }
    const recorder = new VoiceRecorder({
      target: {
        guildId: guild.id,
        channelId: channel.id,
        adapterCreator: guild.voiceAdapterCreator,
      },
      session,
      resolveSpeaker: this.speakerResolver(guild),
      alert: msg => void channel.send(msg).catch(() => undefined),
    });
    this.active = { session, recorder, channel };
    try {
      await recorder.start();
    } catch (err) {
      await this.stop('join failed');
      await i.editReply(`Could not join ${channel.name}: ${(err as Error).message}`);
      return;
    }
    await i.editReply(NOTICE);
  }

  /** Stop the active recording, convert it and return a short summary. */
  async stop(reason: string): Promise<string> {
    const a = this.active;
    if (!a) return 'Not recording.';
    this.active = undefined;
    a.recorder.stop();
    const tracks = await a.session.stop(reason);
    if (tracks.length === 0)
      return 'Recording stopped. Nobody spoke, so there is nothing to convert.';
    try {
      const result = convertSession(a.session.dir);
      const lines = result.tracks.map(
        t =>
          `${t.file}: ${Math.round(t.seconds / 60)} min, ${t.stats.packets} packets${
            t.stats.droppedDave ? `, ${t.stats.droppedDave} undecrypted dropped` : ''
          }`
      );
      return `Recording stopped and converted (${a.session.dir}):\n${lines.join('\n')}`;
    } catch (err) {
      return `Recording stopped, but converting failed: ${(err as Error).message}. The raw files are kept in ${a.session.dir}.`;
    }
  }

  async shutdown(): Promise<void> {
    if (this.spaceTimer) clearInterval(this.spaceTimer);
    if (this.active) log.info(await this.stop('shutdown'));
    await this.client.destroy();
  }
}
