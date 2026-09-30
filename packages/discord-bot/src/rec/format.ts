/**
 * The raw per-speaker recording file (`<n>-<name>.rec`).
 *
 * Nothing is decoded while recording: every Opus packet is written as it arrived, with the
 * arrival time on the session clock and the RTP sequence and timestamp when known. The offline
 * converter (`convert/`) turns this into audio with the silences put back.
 *
 * Layout: an 8-byte magic, a u32 header length, a UTF-8 JSON header, then records:
 *
 * | bytes | field                                                          |
 * | ----- | -------------------------------------------------------------- |
 * | 4     | arrival, in 48 kHz samples since session start (u32, ~24.8 h)  |
 * | 2     | RTP sequence (u16)                                             |
 * | 4     | RTP timestamp (u32)                                            |
 * | 1     | flags (bit 0: RTP fields are valid)                            |
 * | 2     | payload length (u16)                                           |
 * | n     | the Opus packet                                                |
 *
 * All numbers are big-endian. A record cut off by a crash at the end of the file is ignored.
 */

export const REC_MAGIC = Buffer.from('FAIREC1\0', 'latin1');
export const RECORD_HEADER_BYTES = 13;
export const FLAG_RTP = 1;

export interface TrackHeader {
  /** Format version of the header JSON. */
  v: 1;
  /** Discord user id. */
  userId: string;
  /** 1-based track number, in the order speakers were first heard. */
  track: number;
  /** Session start, ISO time on the recording PC. */
  sessionStart: string;
}

export interface PacketRecord {
  arrival: number;
  seq: number;
  rtpTimestamp: number;
  hasRtp: boolean;
  payload: Buffer;
}

export function encodeTrackHeader(header: TrackHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([REC_MAGIC, len, json]);
}

export function encodeRecord(rec: PacketRecord): Buffer {
  if (rec.payload.length > 0xffff) throw new RangeError('Opus packet too large');
  const head = Buffer.alloc(RECORD_HEADER_BYTES);
  head.writeUInt32BE(rec.arrival >>> 0, 0);
  head.writeUInt16BE(rec.seq & 0xffff, 4);
  head.writeUInt32BE(rec.rtpTimestamp >>> 0, 6);
  head.writeUInt8(rec.hasRtp ? FLAG_RTP : 0, 10);
  head.writeUInt16BE(rec.payload.length, 11);
  return Buffer.concat([head, rec.payload]);
}

export interface DecodedTrack {
  header: TrackHeader;
  records: PacketRecord[];
  /** Bytes at the end that did not form a whole record (a crash mid-write). */
  truncatedBytes: number;
}

export function decodeTrack(buf: Buffer): DecodedTrack {
  if (buf.length < REC_MAGIC.length + 4 || !buf.subarray(0, REC_MAGIC.length).equals(REC_MAGIC)) {
    throw new Error('Not a recording track (bad magic)');
  }
  const headerLen = buf.readUInt32BE(REC_MAGIC.length);
  const headerStart = REC_MAGIC.length + 4;
  const header = JSON.parse(
    buf.subarray(headerStart, headerStart + headerLen).toString('utf8')
  ) as TrackHeader;

  const records: PacketRecord[] = [];
  let off = headerStart + headerLen;
  while (off + RECORD_HEADER_BYTES <= buf.length) {
    const len = buf.readUInt16BE(off + 11);
    if (off + RECORD_HEADER_BYTES + len > buf.length) break;
    records.push({
      arrival: buf.readUInt32BE(off),
      seq: buf.readUInt16BE(off + 4),
      rtpTimestamp: buf.readUInt32BE(off + 6),
      hasRtp: (buf.readUInt8(off + 10) & FLAG_RTP) !== 0,
      payload: Buffer.from(
        buf.subarray(off + RECORD_HEADER_BYTES, off + RECORD_HEADER_BYTES + len)
      ),
    });
    off += RECORD_HEADER_BYTES + len;
  }
  return { header, records, truncatedBytes: buf.length - off };
}
