import { describe, expect, it } from 'vitest';
import { OggOpusWriter, oggCrc } from './ogg.js';

interface Page {
  headerType: number;
  granule: bigint;
  seq: number;
  packets: Buffer[];
  crcOk: boolean;
}

/** Parse Ogg pages back (packets never span pages in our writer). */
function parsePages(buf: Buffer): Page[] {
  const pages: Page[] = [];
  let off = 0;
  while (off < buf.length) {
    expect(buf.toString('latin1', off, off + 4)).toBe('OggS');
    const nseg = buf.readUInt8(off + 26);
    const lacing = [...buf.subarray(off + 27, off + 27 + nseg)];
    const size = 27 + nseg + lacing.reduce((a, b) => a + b, 0);
    const page = Buffer.from(buf.subarray(off, off + size));
    const crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    const packets: Buffer[] = [];
    let pos = off + 27 + nseg;
    let cur = 0;
    for (const l of lacing) {
      cur += l;
      if (l < 255) {
        packets.push(buf.subarray(pos, pos + cur));
        pos += cur;
        cur = 0;
      }
    }
    pages.push({
      headerType: buf.readUInt8(off + 5),
      granule: buf.readBigInt64LE(off + 6),
      seq: buf.readUInt32LE(off + 18),
      packets,
      crcOk: oggCrc(page) === crc,
    });
    off += size;
  }
  return pages;
}

describe('oggCrc', () => {
  it('matches the Ogg CRC-32 check value', () => {
    // The Ogg CRC is CRC-32/POSIX without the final xor: "123456789" -> ~0x765E7680.
    expect(oggCrc(Buffer.from('123456789', 'ascii'))).toBe(0x89a1897f);
  });
});

describe('OggOpusWriter', () => {
  it('writes the two header pages, packet pages with granules, and an EOS page', () => {
    const w = new OggOpusWriter(7, 2, ['DISCORD_USER_ID=1']);
    const big = Buffer.alloc(600, 0xaa); // spans three lacing values
    big[0] = 0xfc;
    for (let i = 0; i < 20; i++) w.write(i === 3 ? big : Buffer.from([0xfc, i]), 960);
    const pages = parsePages(w.finish());

    expect(pages.every(p => p.crcOk)).toBe(true);
    expect(pages.map(p => p.seq)).toEqual(pages.map((_, i) => i));
    expect(pages[0].headerType).toBe(2);
    expect(pages[0].packets[0].toString('latin1', 0, 8)).toBe('OpusHead');
    expect(pages[0].packets[0].readUInt8(9)).toBe(2);
    expect(pages[1].packets[0].toString('latin1', 0, 8)).toBe('OpusTags');
    expect(pages[1].packets[0].includes(Buffer.from('DISCORD_USER_ID=1'))).toBe(true);

    const audio = pages.slice(2);
    expect(audio.at(-1)!.headerType).toBe(4);
    expect(audio.at(-1)!.granule).toBe(20n * 960n);
    const packets = audio.flatMap(p => p.packets);
    expect(packets).toHaveLength(20);
    expect(packets[3].equals(big)).toBe(true);
    expect(w.samplesWritten).toBe(19_200n);
  });

  it('splits pages before 255 lacing values', () => {
    const w = new OggOpusWriter(1);
    for (let i = 0; i < 600; i++) w.write(Buffer.from([0xf8, 0xff, 0xfe]), 960);
    const pages = parsePages(w.finish()).slice(2);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.flatMap(p => p.packets)).toHaveLength(600);
    // granules only grow, and each equals the samples of all packets up to that page's end
    let count = 0;
    for (const p of pages) {
      count += p.packets.length;
      expect(p.granule).toBe(BigInt(count * 960));
    }
  });
});
