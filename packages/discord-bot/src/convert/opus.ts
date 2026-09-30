/** Small Opus packet helpers (RFC 6716), enough to place packets on a timeline. */

/** A 20 ms Opus silence frame, the same one Discord and `@discordjs/voice` use. */
export const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
export const SAMPLES_PER_FRAME = 960; // 20 ms at 48 kHz

/** Frame size in 48 kHz samples for each of the 32 TOC configurations. */
const FRAME_SAMPLES: readonly number[] = [
  // SILK NB/MB/WB: 10, 20, 40, 60 ms
  480, 960, 1920, 2880, 480, 960, 1920, 2880, 480, 960, 1920, 2880,
  // Hybrid SWB/FB: 10, 20 ms
  480, 960, 480, 960,
  // CELT NB/WB/SWB/FB: 2.5, 5, 10, 20 ms
  120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960, 120, 240, 480, 960,
];

/** Number of 48 kHz samples an Opus packet decodes to, or 0 if it is not a valid packet. */
export function opusPacketSamples(packet: Buffer): number {
  if (packet.length < 1) return 0;
  const toc = packet[0];
  const perFrame = FRAME_SAMPLES[toc >> 3];
  switch (toc & 3) {
    case 0:
      return perFrame;
    case 1:
    case 2:
      return perFrame * 2;
    default: {
      if (packet.length < 2) return 0;
      const frames = packet[1] & 0x3f;
      const total = perFrame * frames;
      return total > 5760 ? 0 : total; // at most 120 ms per packet
    }
  }
}

/**
 * True for a frame that is still DAVE end-to-end encrypted. `@discordjs/voice` passes frames
 * through unchanged while the DAVE session is not ready yet; they end with the 0xFAFA marker
 * and decode to noise, so the converter drops them.
 */
export function isDaveEncrypted(packet: Buffer): boolean {
  return (
    packet.length >= 2 &&
    packet[packet.length - 1] === 0xfa &&
    packet[packet.length - 2] === 0xfa &&
    !packet.equals(SILENCE_FRAME)
  );
}
