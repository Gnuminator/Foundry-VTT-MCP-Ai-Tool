/**
 * Small pure helpers the bot uses for the recorder heartbeat (item recorder-heartbeat), kept apart
 * from the Discord client so they can be tested.
 */

import { bi } from './i18n.js';

export interface VoiceStateLike {
  channelId: string | null;
  selfMute?: boolean | null;
  serverMute?: boolean | null;
}

export type VoiceAction = 'join' | 'leave' | 'mute-change' | 'ignore';

/** What a voice state change means for the recorded channel. */
export function voiceAction(
  before: VoiceStateLike,
  after: VoiceStateLike,
  channelId: string
): VoiceAction {
  if (before.channelId !== channelId && after.channelId === channelId) return 'join';
  if (before.channelId === channelId && after.channelId !== channelId) return 'leave';
  if (after.channelId === channelId) return 'mute-change';
  return 'ignore';
}

export function isMuted(state: VoiceStateLike): boolean {
  return Boolean(state.selfMute || state.serverMute);
}

/** Where a recorder alert goes: the configured GM channel, else the fallback, else nowhere. */
export function alertTarget(
  gmChannelId: string | undefined,
  hasFallback: boolean
): 'gm' | 'fallback' | 'none' {
  if (gmChannelId) return 'gm';
  return hasFallback ? 'fallback' : 'none';
}

/** The `/record status` reply while recording. */
export function statusText(
  channelName: string,
  tracks: number,
  rtpTap: boolean,
  connection: string,
  speakerLines: string[]
): string {
  return [
    bi(
      `Optager i ${channelName}: ${tracks} spor, RTP tap ${rtpTap ? 'til' : 'fra'}.`,
      `Recording in ${channelName}: ${tracks} track(s), RTP tap ${rtpTap ? 'on' : 'off'}.`
    ),
    `Voice-forbindelse / Voice connection: ${connection}.`,
    ...speakerLines,
  ].join('\n');
}
