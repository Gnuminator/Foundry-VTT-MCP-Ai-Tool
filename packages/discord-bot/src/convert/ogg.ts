/**
 * A minimal Ogg Opus writer (RFC 3533 pages, RFC 7845 headers). Packets are copied as they are;
 * nothing is decoded or re-encoded.
 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

/** The Ogg CRC-32: polynomial 0x04C11DB7, not reflected, initial value 0, no final xor. */
export function oggCrc(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc;
}

const HEADER_BOS = 2;
const HEADER_EOS = 4;
const MAX_SEGMENTS = 255;
/** Flush a page once it holds about this many bytes of packets (keeps seeking cheap). */
const TARGET_PAGE_BYTES = 4096;

export function buildPage(
  packets: readonly Buffer[],
  granule: bigint,
  serial: number,
  pageSeq: number,
  headerType: number
): Buffer {
  const lacing: number[] = [];
  for (const p of packets) {
    let left = p.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
  }
  if (lacing.length > MAX_SEGMENTS) throw new RangeError('Too many segments for one Ogg page');
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'latin1');
  head.writeUInt8(0, 4);
  head.writeUInt8(headerType, 5);
  head.writeBigInt64LE(granule, 6);
  head.writeUInt32LE(serial >>> 0, 14);
  head.writeUInt32LE(pageSeq >>> 0, 18);
  head.writeUInt32LE(0, 22);
  head.writeUInt8(lacing.length, 26);
  Buffer.from(lacing).copy(head, 27);
  const page = Buffer.concat([head, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function segmentsFor(packet: Buffer): number {
  return Math.floor(packet.length / 255) + 1;
}

export function opusHead(channels: number, preSkip = 0, inputRate = 48000): Buffer {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'latin1');
  b.writeUInt8(1, 8);
  b.writeUInt8(channels, 9);
  b.writeUInt16LE(preSkip, 10);
  b.writeUInt32LE(inputRate, 12);
  b.writeInt16LE(0, 16);
  b.writeUInt8(0, 18);
  return b;
}

export function opusTags(vendor: string, comments: readonly string[] = []): Buffer {
  const parts: Buffer[] = [Buffer.from('OpusTags', 'latin1')];
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const v = Buffer.from(vendor, 'utf8');
  parts.push(u32(v.length), v, u32(comments.length));
  for (const c of comments) {
    const cb = Buffer.from(c, 'utf8');
    parts.push(u32(cb.length), cb);
  }
  return Buffer.concat(parts);
}

/** Collects pages in memory; `finish()` returns the whole file. */
export class OggOpusWriter {
  private readonly pages: Buffer[] = [];
  private pending: Buffer[] = [];
  private pendingSegments = 0;
  private pendingBytes = 0;
  private pageSeq = 0;
  private granule = 0n;

  constructor(
    private readonly serial: number,
    channels = 2,
    comments: readonly string[] = []
  ) {
    this.pages.push(buildPage([opusHead(channels)], 0n, serial, this.pageSeq++, HEADER_BOS));
    this.pages.push(
      buildPage([opusTags('foundry-ai-tool discord-bot', comments)], 0n, serial, this.pageSeq++, 0)
    );
  }

  /** Add one Opus packet that decodes to `samples` 48 kHz samples. */
  write(packet: Buffer, samples: number): void {
    const segs = segmentsFor(packet);
    if (this.pendingSegments + segs > MAX_SEGMENTS) this.flush(0);
    this.pending.push(packet);
    this.pendingSegments += segs;
    this.pendingBytes += packet.length;
    this.granule += BigInt(samples);
    if (this.pendingBytes >= TARGET_PAGE_BYTES) this.flush(0);
  }

  get samplesWritten(): bigint {
    return this.granule;
  }

  private flush(headerType: number): void {
    if (this.pending.length === 0 && headerType !== HEADER_EOS) return;
    this.pages.push(buildPage(this.pending, this.granule, this.serial, this.pageSeq++, headerType));
    this.pending = [];
    this.pendingSegments = 0;
    this.pendingBytes = 0;
  }

  finish(): Buffer {
    this.flush(HEADER_EOS);
    return Buffer.concat(this.pages);
  }
}
