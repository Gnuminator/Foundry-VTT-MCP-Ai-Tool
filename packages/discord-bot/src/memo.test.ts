import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MAX_MEMO_BYTES,
  audioAttachments,
  memoFileName,
  memoSenderAllowed,
  saveMemos,
  type MemoAttachment,
} from './memo.js';

const voice: MemoAttachment = {
  name: 'voice-message.ogg',
  contentType: 'audio/ogg',
  size: 20_000,
  url: 'https://cdn.example/v.ogg',
};
const picture: MemoAttachment = {
  name: 'a.png',
  contentType: 'image/png',
  size: 10,
  url: 'https://cdn.example/a.png',
};

describe('voice memos', () => {
  it('keeps audio attachments by type or extension', () => {
    const byExt = { ...picture, name: 'idea.M4A', contentType: null };
    expect(audioAttachments([voice, picture, byExt])).toEqual([voice, byExt]);
  });

  it('lets the listed ids in, else only the owner', () => {
    expect(memoSenderAllowed('1', ['1', '2'], '9')).toBe(true);
    expect(memoSenderAllowed('9', ['1', '2'], '9')).toBe(false);
    expect(memoSenderAllowed('9', [], '9')).toBe(true);
    expect(memoSenderAllowed('1', [], undefined)).toBe(false);
  });

  it('names the file by local time and message id', () => {
    const d = new Date(2026, 10, 26, 14, 5);
    expect(memoFileName(d, '123456', voice, 0)).toBe('2026-11-26_1405-123456.ogg');
    expect(memoFileName(d, '123456', { ...voice, name: null }, 1)).toBe(
      '2026-11-26_1405-123456-2.ogg'
    );
  });

  it('saves audio into the inbox and skips files that are too big', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memo-'));
    const big = { ...voice, size: MAX_MEMO_BYTES + 1 };
    const r = await saveMemos(dir, '55', new Date(2026, 10, 26, 9, 0), [picture, voice, big], () =>
      Promise.resolve(new Uint8Array([1, 2, 3]))
    );
    expect(r).toEqual({ saved: ['2026-11-26_0900-55.ogg'], tooBig: 1 });
    expect(readdirSync(join(dir, 'inbox'))).toEqual(['2026-11-26_0900-55.ogg']);
    expect([...readFileSync(join(dir, 'inbox', '2026-11-26_0900-55.ogg'))]).toEqual([1, 2, 3]);
    expect(existsSync(join(dir, 'inbox', '2026-11-26_0900-55.ogg.part'))).toBe(false);
  });
});
