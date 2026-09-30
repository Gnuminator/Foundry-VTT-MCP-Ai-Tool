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

export const RECORD_COMMAND = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Record the voice channel, one track per speaker')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(s => s.setName('start').setDescription('Join your voice channel and record'))
  .addSubcommand(s => s.setName('stop').setDescription('Stop recording and prepare the audio'))
  .addSubcommand(s => s.setName('status').setDescription('Show what is being recorded'));

const NOTICE =
  'Recording started: this voice channel is recorded, one track per person, for the session ' +
  'notes. The audio stays on the GM side and is deleted after the notes are approved.';

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
    if (!guild || !channel || channel.type !== ChannelType.GuildVoice) {
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
    if (this.active) log.info(await this.stop('shutdown'));
    await this.client.destroy();
  }
}
