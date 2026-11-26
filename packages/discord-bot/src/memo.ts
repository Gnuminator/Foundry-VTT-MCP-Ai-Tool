/**
 * Voice memos (idea 3.9): the GM sends the bot a voice message or an audio file in a direct message;
 * the bot saves it in the memos inbox (`FVTT_MEMOS_DIR`, default `FoundryMemos` in the data folder)
 * and answers with one line. The PC turns the inbox into prep notes with `scripts/voice-memos.mjs`
 * (local speech to text, nothing is sent anywhere). Only the GM (`DISCORD_MEMO_USER_IDS`, else the
 * owner) is listened to; anyone else gets no reply and nothing is saved.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { bi } from './i18n.js';

const AUDIO_EXTENSIONS = new Set([
  '.ogg',
  '.oga',
  '.opus',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
]);
/** A memo is short; a bigger file is not one (a 30 s voice message is well under 1 MB). */
export const MAX_MEMO_BYTES = 25 * 1024 * 1024;

export interface MemoAttachment {
  name: string | null;
  contentType: string | null;
  size: number;
  url: string;
}

/** The audio attachments of a message: by content type, else by file extension. */
export function audioAttachments<T extends MemoAttachment>(attachments: Iterable<T>): T[] {
  return [...attachments].filter(a => {
    if (a.contentType?.startsWith('audio/')) return true;
    return AUDIO_EXTENSIONS.has(extname(a.name ?? '').toLowerCase());
  });
}

/** Who may send memos: the listed ids, else the owner; nobody when neither is known. */
export function memoSenderAllowed(
  userId: string,
  memoUserIds: readonly string[],
  ownerId: string | undefined
): boolean {
  if (memoUserIds.length > 0) return memoUserIds.includes(userId);
  return ownerId !== undefined && userId === ownerId;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `2026-11-26_1405-<messageId>.ogg`: sorts by time, and the message id keeps two memos apart. */
export function memoFileName(
  d: Date,
  messageId: string,
  att: MemoAttachment,
  index: number
): string {
  const ext = extname(att.name ?? '').toLowerCase();
  const safeExt = AUDIO_EXTENSIONS.has(ext) ? ext : '.ogg'; // a Discord voice message is Ogg Opus
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `${stamp}-${messageId.replace(/\D/g, '')}${suffix}${safeExt}`;
}

export const MEMO_SAVED = bi(
  'Memo gemt. Det bliver til en prep-note, næste gang pc’en henter memoer.',
  'Memo saved. It becomes a prep note the next time the PC picks up memos.'
);
export const MEMO_TOO_BIG = bi(
  'Den fil er for stor til et memo (grænsen er 25 MB).',
  'That file is too big for a memo (the limit is 25 MB).'
);
export const MEMO_NO_AUDIO = bi(
  'Send et lydmemo (en voice message eller en lydfil), så gemmer jeg det.',
  'Send a voice memo (a voice message or an audio file) and I will save it.'
);

export const MEMO_FAILED = bi(
  'Memoet kunne ikke gemmes. Prøv igen om lidt.',
  'The memo could not be saved. Try again in a moment.'
);

type Download = (url: string) => Promise<Uint8Array>;

interface MemoResult {
  saved: string[];
  tooBig: number;
}

/** Save every audio attachment into `<memosDir>/inbox`. A partial file never shows (temp name, then rename). */
export async function saveMemos(
  memosDir: string,
  messageId: string,
  at: Date,
  attachments: readonly MemoAttachment[],
  download: Download
): Promise<MemoResult> {
  const inbox = join(memosDir, 'inbox');
  mkdirSync(inbox, { recursive: true });
  const result: MemoResult = { saved: [], tooBig: 0 };
  for (const [i, att] of audioAttachments(attachments).entries()) {
    if (att.size > MAX_MEMO_BYTES) {
      result.tooBig++;
      continue;
    }
    const name = memoFileName(at, messageId, att, i);
    const tmp = join(inbox, `${name}.part`);
    writeFileSync(tmp, await download(att.url));
    renameSync(tmp, join(inbox, name));
    result.saved.push(name);
  }
  return result;
}
