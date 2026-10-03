/**
 * A minimal Ogg Opus reader: the packets of the first logical stream, header packets skipped.
 * The counterpart of `convert/ogg.ts`; used to send prepared Opus frames as they are.
 */

export interface OggOpus {
  /** Samples to skip at the start (OpusHead pre-skip, 48 kHz). */
  preSkip: number;
  channels: number;
  packets: Buffer[];
}

export function readOggOpus(file: Buffer): OggOpus {
  const packets: Buffer[] = [];
  let partial: Buffer[] = [];
  let serial: number | undefined;
  let pos = 0;
  while (pos + 27 <= file.length) {
    if (file.toString('latin1', pos, pos + 4) !== 'OggS') {
      throw new Error(`Not an Ogg page at byte ${pos}`);
    }
    const pageSerial = file.readUInt32LE(pos + 14);
    const segments = file.readUInt8(pos + 26);
    const lacing = file.subarray(pos + 27, pos + 27 + segments);
    let body = pos + 27 + segments;
    serial ??= pageSerial;
    const own = pageSerial === serial;
    for (const len of lacing) {
      if (own) partial.push(file.subarray(body, body + len));
      body += len;
      if (len < 255 && own) {
        packets.push(Buffer.concat(partial));
        partial = [];
      }
    }
    pos = body;
  }
  const head = packets[0];
  if (!head || head.toString('latin1', 0, 8) !== 'OpusHead') throw new Error('No OpusHead packet');
  const tags = packets[1];
  if (!tags || tags.toString('latin1', 0, 8) !== 'OpusTags') throw new Error('No OpusTags packet');
  return { preSkip: head.readUInt16LE(10), channels: head.readUInt8(9), packets: packets.slice(2) };
}

/** Frame length of an Opus packet in 48 kHz samples, from its TOC byte (RFC 6716, 3.1). */
export function opusPacketSamples(packet: Buffer): number {
  const toc = packet[0];
  if (toc === undefined) return 0;
  const config = toc >> 3;
  let frame: number;
  if (config < 12)
    frame = [480, 960, 1920, 2880][config % 4]!; // SILK: 10, 20, 40, 60 ms
  else if (config < 16)
    frame = [480, 960][config % 2]!; // hybrid: 10, 20 ms
  else frame = [120, 240, 480, 960][config % 4]!; // CELT: 2.5, 5, 10, 20 ms
  const code = toc & 3;
  if (code === 0) return frame;
  if (code === 1 || code === 2) return frame * 2;
  const count = (packet[1] ?? 0) & 0x3f;
  return frame * count;
}
