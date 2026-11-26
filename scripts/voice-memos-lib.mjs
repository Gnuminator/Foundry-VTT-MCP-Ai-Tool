// Voice memos into prep (idea 3.9): the pure parts. scripts/voice-memos.mjs runs them on the PC.
// An audio file in the memos inbox becomes a dated, tagged note in the GM vault under
// Prep/Voice memos. Names to tag come from the GM's own prep notes (file names under Prep).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';

export const MEMO_NOTES_DIR = 'Prep/Voice memos';
export const AUDIO_EXTENSIONS = new Set([
  '.ogg',
  '.oga',
  '.opus',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
  '.flac',
]);
const SKIPPED_PREP_DIRS = new Set(['templates', 'voice memos']);

/** The segment texts of one transcriber JSON, joined and tidied. */
export function transcriptText(json) {
  const segs = Array.isArray(json?.segments) ? json.segments : [];
  return segs
    .map(s => String(s?.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short title: the first sentence, cut at a word to about 60 characters. */
export function makeTitle(text, max = 60) {
  const first = text.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  const clean = first.replace(/[.!?]+$/, '');
  if (!clean) return 'Voice memo';
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).trim()}...`;
}

/** A title made safe for a file name (Windows). */
export function safeFileTitle(title) {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
}

/** Prep notes the memo can point to: `{ name, kind }` for every .md under Prep (not templates or memos). */
export function listPrepNames(vaultDir) {
  const out = [];
  const walk = (dir, kind) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIPPED_PREP_DIRS.has(e.name.toLowerCase())) walk(join(dir, e.name), e.name);
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.md') {
        out.push({ name: basename(e.name, '.md'), kind });
      }
    }
  };
  walk(join(vaultDir, 'Prep'), '');
  return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names found in the text as whole words (case blind, Danish letters count as letters). Longest first. */
export function findTags(text, names) {
  const found = new Map();
  for (const n of names) {
    if (n.name.length < 3 || found.has(n.name)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n.name)}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) found.set(n.name, n);
  }
  return [...found.values()].sort(
    (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name)
  );
}

const p2 = n => String(n).padStart(2, '0');
export const dateOf = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const timeOf = d => `${p2(d.getHours())}${p2(d.getMinutes())}`;

/** The date a memo file was recorded: its `YYYY-MM-DD_HHMM` prefix, else the file's own time. */
export function memoDate(fileName, fallback) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(fileName);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return fallback;
}

/** A name as an Obsidian tag: lower case, spaces to dashes, nothing else but letters, digits, _ and -. */
export function tagOf(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

/**
 * The folder holding `Prep`: `<vault>/Campaigns/<world>` as the bridge writes it. `world` names it;
 * without one the single folder under Campaigns is used; a vault without Campaigns is used as is.
 */
export function resolveCampaignDir(vaultDir, world) {
  const campaigns = join(vaultDir, 'Campaigns');
  if (!existsSync(campaigns)) return vaultDir;
  if (world) {
    const dir = join(campaigns, world);
    if (!existsSync(dir)) throw new Error(`No folder ${dir} (--world ${world}).`);
    return dir;
  }
  const worlds = readdirSync(campaigns, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  if (worlds.length === 1) return join(campaigns, worlds[0]);
  throw new Error(`Which world? ${worlds.length} folders under Campaigns; pass --world <id>.`);
}

/** Note text.`ai_context: true` and the prep properties match the templates in Prep/Templates. */
export function renderNote({ title, text, date, tags, audioName }) {
  const links = tags.map(t => `[[${t.name}]]`);
  return [
    '---',
    'type: voice-memo',
    'status: new',
    `date: ${dateOf(date)}`,
    'fvtt_uuid:',
    'ai_context: true',
    'secret:',
    `tags: [${['voice-memo', ...tags.map(t => tagOf(t.name)).filter(Boolean)].join(', ')}]`,
    `audio: ${audioName}`,
    '---',
    `%% A voice memo, written out by the machine on the PC: names and words can be wrong. Set status to done when you have used it. Players never see your Prep notes. %%`,
    '',
    `# ${title}`,
    '',
    text,
    '',
    ...(links.length > 0 ? [`Mentions: ${links.join(', ')}`, ''] : []),
  ].join('\n');
}

/** A note path that does not exist yet: `<base>.md`, then `<base> 2.md`. */
export function freeNotePath(dir, base) {
  let p = join(dir, `${base}.md`);
  for (let n = 2; existsSync(p); n++) p = join(dir, `${base} ${n}.md`);
  return p;
}

/** The audio files waiting in the inbox (a `.part` file is still being written). */
export function listInbox(inbox) {
  if (!existsSync(inbox)) return [];
  return readdirSync(inbox)
    .filter(f => AUDIO_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
}

/**
 * Turn every memo in `<memosDir>/inbox` into a note, with one transcriber run for all of them.
 * `transcribe(dir)` gets a folder holding `memo1.ogg`, `memo2.ogg` ... (the model loads once) and
 * `names.txt`, and returns `{ memo1: 'text', ... }`. A memo that fails stays in the inbox with an
 * error line in the result; the done ones move to `<memosDir>/done`.
 */
export async function processInbox({ memosDir, vaultDir, transcribe }) {
  const inbox = join(memosDir, 'inbox');
  const done = join(memosDir, 'done');
  const files = listInbox(inbox);
  if (files.length === 0) return [];
  const names = listPrepNames(vaultDir);
  const work = join(memosDir, 'work');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  if (names.length > 0)
    writeFileSync(join(work, 'names.txt'), `${names.map(n => n.name).join('\n')}\n`);
  const stems = new Map(files.map((f, i) => [f, `memo${i + 1}`]));
  for (const [f, stem] of stems) {
    copyFileSync(join(inbox, f), join(work, `${stem}${extname(f).toLowerCase()}`));
  }
  let texts;
  try {
    texts = await transcribe(work);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return files.map(file => ({ file, ok: false, error }));
  }
  const results = [];
  for (const [file, stem] of stems) {
    const src = join(inbox, file);
    try {
      const text = (texts[stem] ?? '').trim();
      if (!text) throw new Error('nothing was heard in the memo');
      const date = memoDate(file, statSync(src).mtime);
      const title = makeTitle(text);
      const tags = findTags(text, names);
      const noteDir = join(vaultDir, MEMO_NOTES_DIR);
      mkdirSync(noteDir, { recursive: true });
      const note = freeNotePath(noteDir, `${dateOf(date)} ${timeOf(date)} ${safeFileTitle(title)}`);
      writeFileSync(note, renderNote({ title, text, date, tags, audioName: file }));
      mkdirSync(done, { recursive: true });
      try {
        renameSync(src, join(done, file));
      } catch (err) {
        rmSync(note, { force: true }); // no duplicate note on the next run
        throw err;
      }
      results.push({ file, ok: true, note, title, tags: tags.map(t => t.name) });
    } catch (err) {
      results.push({ file, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  rmSync(work, { recursive: true, force: true });
  return results;
}
