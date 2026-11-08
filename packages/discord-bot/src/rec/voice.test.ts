import { describe, expect, it } from 'vitest';
import { installRtpTap } from './rtp-tap.js';
import { redactVoiceDebug } from './voice.js';

describe('redactVoiceDebug', () => {
  it('removes the op 4 key, state-dump keys, tokens and nonces', () => {
    // Shapes copied from real @discordjs/voice 0.19.2 debug lines (values made up).
    const op4 = '[NW] [WS] << {"op":4,"d":{"secret_key":[1,2,3],"mode":"aead_aes256_gcm_rtpsize"}}';
    const op0 =
      '[NW] [WS] >> {"op":0,"d":{"server_id":"1","token":"abcd1234","max_dave_protocol_version":1}}';
    const state =
      '"connectionData":{"secretKey":{"0":9,"1":8},"nonceBuffer":{"type":"Buffer","data":[0,0]},"ssrc":1}';
    expect(redactVoiceDebug(op4)).toBe(
      '[NW] [WS] << {"op":4,"d":{"secretKey":"[redacted]","mode":"aead_aes256_gcm_rtpsize"}}'
    );
    expect(redactVoiceDebug(op0)).not.toContain('abcd1234');
    const s = redactVoiceDebug(state);
    expect(s).not.toMatch(/"0":9|"data":\[0,0\]/);
    expect(s).toContain('"ssrc":1');
  });
});

describe('redactVoiceDebug other forms', () => {
  it('removes the session id, the endpoint and name=value secrets', () => {
    const line =
      '[NW] [WS] >> {"op":0,"d":{"session_id":"abc123sess","endpoint":"c-ams01-1.discord.media:443"}} wss://x/?token=tok123&v=8 secret_key=9,8,7';
    const out = redactVoiceDebug(line);
    expect(out).not.toMatch(/abc123sess|discord\.media|tok123|9,8,7|8,7/);
    expect(out).toContain('"op":0');
    expect(out).toContain('v=8');
  });

  it('removes the whole key when it is a list, with or without brackets and spaces', () => {
    expect(redactVoiceDebug('secret_key=9,8,7 next')).toBe('secret_key=[redacted] next');
    expect(redactVoiceDebug('secretKey=[9, 8, 7] next')).toBe('secretKey=[redacted] next');
    expect(redactVoiceDebug('secret_key=9, 8, 7;')).toBe('secret_key=[redacted];');
  });

  it('removes the key after a colon, a space before the value, or in quotes', () => {
    expect(redactVoiceDebug('secret_key: [9, 8, 7] next')).toBe('secret_key=[redacted] next');
    expect(redactVoiceDebug('secret_key= 1,2 next')).toBe('secret_key=[redacted] next');
    expect(redactVoiceDebug('secret_key="abc" next')).toBe('secret_key=[redacted] next');
  });

  it('removes a value that starts with digits but is not a list', () => {
    expect(redactVoiceDebug('secret_key=12ab34 next')).toBe('secret_key=[redacted] next');
    expect(redactVoiceDebug('secret_key=9,8,7abc next')).toBe('secret_key=[redacted] next');
  });
});

describe('installRtpTap', () => {
  it('reports each new stream once and exposes the current RTP header', () => {
    const calls: unknown[] = [];
    const seenInside: unknown[] = [];
    const receiver: { onUdpMessage?: unknown } = {};
    const tap = installRtpTap(
      Object.assign(receiver, {
        onUdpMessage(this: unknown, _msg: Buffer): void {
          seenInside.push(tap.current(7));
        },
      }),
      (ssrc, pt) => calls.push([ssrc, pt])
    );
    const pkt = (seq: number): Buffer => {
      const b = Buffer.alloc(16);
      b[0] = 0x80;
      b[1] = 120;
      b.writeUInt16BE(seq, 2);
      b.writeUInt32BE(seq * 960, 4);
      b.writeUInt32BE(7, 8);
      return b;
    };
    const handler = receiver.onUdpMessage as (m: Buffer) => void;
    handler(pkt(1));
    handler(pkt(2));
    expect(tap.active).toBe(true);
    expect(calls).toEqual([[7, 120]]);
    expect(seenInside).toEqual([
      { seq: 1, timestamp: 960, ssrc: 7 },
      { seq: 2, timestamp: 1920, ssrc: 7 },
    ]);
    expect(tap.current(7)).toBeUndefined(); // cleared after the call
  });
});
