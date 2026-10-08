/**
 * A speaker bot for rehearsals: logs in with its own token, joins the voice channel (deafened,
 * not muted) and sends prepared Opus frames when the rehearsal's scheduler says so.
 */

import {
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice';
import { ChannelType, Client, GatewayIntentBits } from 'discord.js';
import { FRAME_SAMPLES } from './source.js';

export class SpeakerBot {
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  private connection: VoiceConnection | undefined;
  private speaking = false;
  userId = '';
  username = '';

  constructor(
    readonly index: number,
    private readonly token: string
  ) {}

  async login(timeoutMs = 30_000): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('login timed out')), timeoutMs);
      this.client.once('clientReady', c => {
        clearTimeout(timer);
        this.userId = c.user.id;
        this.username = c.user.username;
        resolve();
      });
    });
    await this.client.login(this.token);
    await ready;
  }

  async join(channelId: string, timeoutMs = 30_000): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel?.type !== ChannelType.GuildVoice) {
      throw new Error(
        `speaker ${this.index}: ${channelId} is not a voice channel this bot can see`
      );
    }
    this.connection = joinVoiceChannel({
      guildId: channel.guild.id,
      channelId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      daveEncryption: true,
      // One connection per guild and group: every bot in this process needs its own group.
      group: `rehearsal-${this.index}`,
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, timeoutMs);
  }

  get ready(): boolean {
    return this.connection?.state.status === VoiceConnectionStatus.Ready;
  }

  /** Send one frame now; false when the connection is not ready. */
  send(packet: Buffer): boolean {
    if (!this.connection) return false;
    if (!this.speaking) {
      this.connection.setSpeaking(true);
      this.speaking = true;
    }
    return this.connection.playOpusPacket(packet) === true;
  }

  /** End a burst: the speaking indicator goes off, as when a person stops talking. */
  pause(): void {
    if (this.speaking && this.connection) {
      this.connection.setSpeaking(false);
      this.speaking = false;
    }
  }

  /**
   * Before the first frame after a gap. A real client's RTP timestamp keeps counting through
   * silence; the library only counts frames it sent, so move it on by the frames skipped
   * (internal state; best effort).
   */
  skip(skippedFrames: number): void {
    if (skippedFrames <= 0) return;
    const state = this.connection?.state as { networking?: { state?: unknown } } | undefined;
    const data = (state?.networking?.state as { connectionData?: { timestamp: number } })
      ?.connectionData;
    if (data) data.timestamp = (data.timestamp + skippedFrames * FRAME_SAMPLES) % 2 ** 32;
  }

  async destroy(): Promise<void> {
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    await this.client.destroy();
  }
}
