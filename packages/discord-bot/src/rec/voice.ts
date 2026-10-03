/**
 * Join a voice channel and feed every speaker's Opus packets into a {@link RecordingSession}.
 *
 * - The bot joins self-muted and not deafened (it has to hear to record).
 * - One `Manual` subscription per user for the whole session: `AfterSilence` would end and
 *   restart streams between sentences and lose the first packets of each one.
 * - A stream the library destroys (a decrypt error) is subscribed again at once.
 * - A dropped connection is rejoined with backoff; the session clock keeps running, so the gap
 *   becomes silence in the converted audio and a `disconnected` event in the log.
 */

import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from '@discordjs/voice';
import { installRtpTap, type RtpTap } from './rtp-tap.js';
import type { RecordingSession, SpeakerInfo } from './session.js';

export interface VoiceTarget {
  guildId: string;
  channelId: string;
  adapterCreator: DiscordGatewayAdapterCreator;
}

export interface VoiceRecorderOptions {
  target: VoiceTarget;
  session: RecordingSession;
  resolveSpeaker(userId: string): SpeakerInfo;
  /** Something the GM should know about (connection lost, rejoin failed). */
  alert?(message: string): void;
}

const REJOIN_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * Remove secrets from a `@discordjs/voice` debug line: the voice encryption key (op 4
 * `secret_key`, and `secretKey` in state dumps, as an array or an index object), the voice
 * session `token`, and any `nonceBuffer` contents.
 */
export function redactVoiceDebug(message: string): string {
  return message
    .replace(/"secret_?[kK]ey"\s*:\s*(\[[^\]]*\]|\{[^}]*\})/g, '"secretKey":"[redacted]"')
    .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"[redacted]"')
    .replace(/"nonceBuffer"\s*:\s*\{[^}]*\}/g, '"nonceBuffer":"[redacted]"');
}

export class VoiceRecorder {
  private connection: VoiceConnection | undefined;
  private tap: RtpTap | undefined;
  private readonly subscribed = new Set<string>();
  private stopping = false;
  private rejoinAttempt = 0;

  constructor(private readonly opts: VoiceRecorderOptions) {}

  get rtpTapActive(): boolean {
    return this.tap?.active ?? false;
  }

  /** Join and resolve once the connection is ready (or reject after `timeoutMs`). */
  async start(timeoutMs = 20_000): Promise<void> {
    this.connect();
    await entersState(this.connection!, VoiceConnectionStatus.Ready, timeoutMs);
  }

  private connect(): void {
    const { target, session } = this.opts;
    const connection = joinVoiceChannel({
      guildId: target.guildId,
      channelId: target.channelId,
      adapterCreator: target.adapterCreator,
      selfDeaf: false,
      selfMute: true,
      daveEncryption: true,
      debug: true,
    });
    this.connection = connection;
    this.subscribed.clear();
    const { receiver } = connection;
    // Must happen before the networking layer attaches the UDP listener (see rtp-tap.ts).
    this.tap = installRtpTap(receiver as unknown as { onUdpMessage?: unknown }, (ssrc, pt) => {
      const userId = receiver.ssrcMap.get(ssrc)?.userId;
      session.log({ type: 'udp_ssrc', ssrc, payloadType: pt, userId: userId ?? null });
    });
    session.log({ type: 'connect', channelId: target.channelId, rtpTap: this.tap.active });
    receiver.ssrcMap.on('create', (data: { userId: string; audioSSRC: number }) =>
      session.log({ type: 'ssrc_mapped', userId: data.userId, ssrc: data.audioSSRC })
    );

    const { speaking } = receiver;
    speaking.on('start', (userId: string) => {
      session.log({ type: 'speaking_start', userId });
      this.subscribe(userId);
    });
    speaking.on('end', (userId: string) => session.log({ type: 'speaking_end', userId }));

    connection.on('stateChange', (from, to) => {
      if (from.status === to.status) return;
      session.log({ type: 'connection_state', from: from.status, to: to.status });
      if (to.status === VoiceConnectionStatus.Ready) this.rejoinAttempt = 0;
      if (to.status === VoiceConnectionStatus.Disconnected) void this.onDisconnected(connection);
      const current = this.connection === connection;
      if (to.status === VoiceConnectionStatus.Destroyed && current && !this.stopping) {
        void this.reconnect();
      }
    });
    connection.on('error', err => session.log({ type: 'connection_error', message: err.message }));
    connection.on('debug', (message: string) => {
      // The full stream goes to voice-debug.log with keys and tokens removed; the event log
      // only gets the library's own DAVE and decrypt lines, never raw gateway payloads.
      const clean = redactVoiceDebug(message);
      session.debug(clean);
      if (/^\[NW\] \[DAVE\]|decrypt/i.test(message)) session.log({ type: 'debug', message: clean });
    });
  }

  private subscribe(userId: string): void {
    const connection = this.connection;
    if (!connection || this.stopping || this.subscribed.has(userId)) return;
    const { receiver } = connection;
    const speaker = this.opts.resolveSpeaker(userId);
    const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.Manual } });
    this.subscribed.add(userId);
    this.opts.session.log({ type: 'subscribe', userId, username: speaker.username });

    stream.on('data', (packet: Buffer) => {
      const rtp = this.tap?.current(receiver.ssrcMap.get(userId)?.audioSSRC);
      this.opts.session.packet(speaker, packet, rtp);
    });
    stream.on('error', (err: Error) =>
      this.opts.session.log({ type: 'stream_error', userId, message: err.message })
    );
    stream.once('close', () => {
      this.subscribed.delete(userId);
      this.opts.session.log({ type: 'stream_closed', userId });
      if (!this.stopping && this.connection === connection)
        setImmediate(() => this.subscribe(userId));
    });
  }

  private async onDisconnected(connection: VoiceConnection): Promise<void> {
    this.opts.session.log({ type: 'disconnected' });
    try {
      // Moving channels or a short network hiccup: the library reconnects by itself.
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (this.stopping || this.connection !== connection) return;
      this.opts.alert?.('Recording bot lost the voice connection; trying to rejoin.');
      this.destroyConnection(); // the Destroyed handler rejoins
    }
  }

  private async reconnect(): Promise<void> {
    const delay = REJOIN_DELAYS_MS[Math.min(this.rejoinAttempt, REJOIN_DELAYS_MS.length - 1)];
    this.rejoinAttempt++;
    this.opts.session.log({ type: 'rejoin_wait', attempt: this.rejoinAttempt, delayMs: delay });
    await new Promise(r => setTimeout(r, delay));
    if (this.stopping) return;
    try {
      await this.start();
      this.opts.session.log({ type: 'rejoined', attempt: this.rejoinAttempt });
      this.opts.alert?.('Recording bot is back in the voice channel.');
    } catch (err) {
      this.opts.session.log({ type: 'rejoin_failed', message: (err as Error).message });
      if (this.rejoinAttempt === 3) this.opts.alert?.('Recording bot still cannot rejoin voice.');
      // Destroying the half-open connection schedules the next try through its Destroyed event.
      this.destroyConnection();
    }
  }

  private destroyConnection(): void {
    const connection = this.connection;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
  }

  /**
   * Rehearsals only: drop the voice connection as if it failed, so the normal rejoin path
   * (backoff, rejoin, alerts) runs.
   */
  simulateDrop(): void {
    this.opts.session.log({ type: 'simulated_drop' });
    this.destroyConnection();
  }

  stop(): void {
    this.stopping = true;
    this.destroyConnection();
  }
}
