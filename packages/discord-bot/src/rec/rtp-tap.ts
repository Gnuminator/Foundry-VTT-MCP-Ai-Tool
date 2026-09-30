/**
 * Keep the RTP sequence and timestamp that `@discordjs/voice` reads and then throws away.
 *
 * `VoiceReceiver.onUdpMessage` parses the raw UDP packet and pushes the Opus payload to the
 * user's stream synchronously, in the same call. Wrapping it lets us note the RTP header of the
 * packet being handled, so the `data` handler that runs inside that call can pick it up.
 *
 * This leans on library internals (checked against @discordjs/voice 0.19.2, which is pinned).
 * The networking layer attaches `receiver.onUdpMessage` to the UDP socket when it connects and
 * again after a reconnect, so the wrapper must be installed right after `joinVoiceChannel`,
 * before the connection is ready. If the internals change, the tap reports itself as inactive
 * and the recorder still works on arrival times alone.
 */

import type { RtpInfo } from './session.js';

interface ReceiverLike {
  onUdpMessage?: unknown;
}

export interface RtpTap {
  /** True once the wrapper was installed. */
  readonly active: boolean;
  /** The RTP header of the packet currently being handled, if it came from `ssrc`. */
  current(ssrc: number | undefined): RtpInfo | undefined;
}

export function parseRtpHeader(msg: Buffer): (RtpInfo & { ssrc: number }) | undefined {
  if (msg.length < 12 || msg[0] >> 6 !== 2) return undefined;
  return { seq: msg.readUInt16BE(2), timestamp: msg.readUInt32BE(4), ssrc: msg.readUInt32BE(8) };
}

export function installRtpTap(receiver: ReceiverLike): RtpTap {
  let last: (RtpInfo & { ssrc: number }) | undefined;
  const original = receiver.onUdpMessage;
  if (typeof original !== 'function') {
    return { active: false, current: () => undefined };
  }
  const wrapped = function (this: unknown, msg: Buffer): unknown {
    last = Buffer.isBuffer(msg) ? parseRtpHeader(msg) : undefined;
    try {
      return (original as (m: Buffer) => unknown).call(this, msg);
    } finally {
      last = undefined;
    }
  };
  receiver.onUdpMessage = wrapped.bind(receiver);
  return {
    active: true,
    current: ssrc => (last && ssrc !== undefined && last.ssrc === ssrc ? last : undefined),
  };
}
