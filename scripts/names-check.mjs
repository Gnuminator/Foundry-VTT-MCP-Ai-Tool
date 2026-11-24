#!/usr/bin/env node
/**
 * Names check entries for any session folder (backlog `names-check-pipeline`).
 *
 *   node scripts/names-check.mjs <session folder or name> [--candidates file.json] [--out dir]
 *                                [--no-clips] [--max 3] [--lead 6]
 *
 * Reads `timeline/timeline.jsonl` (the raw transcript, what the transcriber heard) and
 * `notes/transcript.en.md` (the cleaned one), builds one card per candidate name and writes
 * them to `<session>/notes/names-check/`:
 *
 *   entries/name-NN.json   one card: up to 3 raw lines with the hit, the cleaner's line from the
 *                          same speaker, a clip per line (`clipfile`, filled in with `audio` once uploaded)
 *   clips/*.mp4            about 6 s either side of the hit, cut from that speaker's own track
 *                          (mp4 audio: artifact assets reject mp3 and ogg)
 *   sweep.json             names beyond the candidate list, and duplicates between cards
 *
 * Candidates come from the names check page, the NPC list in `notes/notes.json`, `timeline/fixes.json`
 * and any `--candidates` file ([{word, also?, guess?, note?}]). Nothing here is posted anywhere:
 * clips hold the friends' voices, so the output stays in the session folder and the artifact is private.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- small helpers ----------

export function hms(sec) {
  const x = Math.floor(sec);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(x / 3600))}:${p(Math.floor((x % 3600) / 60))}:${p(x % 60)}`;
}

/** "Barnon (David)" -> "David"; a speaker with no brackets stays as it is. */
export function who(label) {
  const m = /\(([^)]*)\)\s*$/.exec(label || '');
  return m ? m[1] : label || '';
}

export function lineId(n) {
  return 'u' + String(n).padStart(6, '0');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function similarity(a, b) {
  const n = Math.max(a.length, b.length);
  return n ? 1 - levenshtein(a, b) / n : 1;
}

// ---------- matching ----------

/**
 * One regex for a name and its other spellings: whole word only, plus an inflected form
 * (plural, Danish endings) and a possessive ('s or ’s).
 */
export function termRegex(terms) {
  const clean = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const longest = clean.reduce((m, t) => Math.max(m, t.length), 0);
  const infl = longest <= 4 ? '(?:s)?' : '(?:s|e|en|ene|er|et)?';
  const alt = clean.sort((a, b) => b.length - a.length).map(esc).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alt})${infl}(?:['’]s)?(?![\\p{L}\\p{N}])`, 'iu');
}

/** Up to `max` hits spread over the session: first, middle, last (or evenly for more). */
export function spread(hits, max = 3) {
  if (hits.length <= max) return hits;
  const idx = new Set();
  for (let i = 0; i < max; i++) idx.add(Math.round((i * (hits.length - 1)) / (max - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => hits[i]);
}

/** The clip window: `lead` seconds either side of the hit, never before 0. */
export function clipWindow(wordStart, wordEnd, lead = 6) {
  const start = Math.max(0, wordStart - lead);
  return { start, end: Math.max(wordEnd, wordStart) + lead };
}

// ---------- reading a session ----------

export function loadTimeline(session) {
  const p = path.join(session, 'timeline', 'timeline.jsonl');
  const rows = [];
  let n = 0;
  for (const raw of fs.readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    n += 1;
    rows.push({ ...JSON.parse(raw), n, id: lineId(n) });
  }
  return rows;
}

/** The cleaned English transcript: `**[hh:mm:ss] Speaker:** text ^uNNNNNN`. */
export function parseCleaned(md) {
  const out = [];
  for (const l of md.split(/\r?\n/)) {
    const m = /^\*\*\[(\d+):(\d+):(\d+)\] (.+?):\*\* (.*?)(?: \^(u\d+))?\s*$/.exec(l);
    if (!m) continue;
    const text = m[5].replace(/\s*\(out of character\)\s*$/, '').trim().replace(/^\*+|\*+$/g, '');
    out.push({ t: +m[1] * 3600 + +m[2] * 60 + +m[3], speaker: m[4], text, id: m[6] || '' });
  }
  return out;
}

/**
 * The cleaner's line for a raw row: same line id and same player first; else the latest line
 * by the same player that starts no more than 2 s after the hit and no more than 40 s before it.
 * A line by someone else is never returned (a time-only match was wrong for 10 of 49 cards).
 */
export function cleanerLine(cleaned, row, hitStart) {
  const player = who(row.player || row.speaker);
  const byId = cleaned.find((c) => c.id && c.id === row.id && who(c.speaker) === player);
  if (byId) return byId;
  const near = cleaned.filter((c) => who(c.speaker) === player && c.t <= hitStart + 2 && hitStart - c.t <= 40);
  return near.length ? near.reduce((a, b) => (b.t > a.t ? b : a)) : null;
}

/** Cut a long cleaned line to about 220 characters around the first of `keys` that it holds. */
export function excerpt(text, keys, width = 220) {
  if (text.length <= width) return text;
  const pos = keys.map((k) => (k ? text.toLowerCase().indexOf(k.toLowerCase()) : -1)).filter((x) => x >= 0);
  const a = pos.length ? Math.max(0, Math.min(...pos) - 100) : 0;
  return (a ? '…' : '') + text.slice(a, a + width) + (a + width < text.length ? '…' : '');
}

/** The cleaner's spelling: a capitalised word in its lines that is close to, but not, a heard spelling. */
export function cleanerSpelling(terms, cleanLines) {
  const tally = new Map();
  for (const t of cleanLines) {
    for (const m of t.matchAll(/[\p{Lu}][\p{L}'’-]{2,}/gu)) {
      const w = m[0].replace(/['’]s$/, '');
      if (terms.some((x) => x.toLowerCase() === w.toLowerCase())) continue;
      if (terms.some((x) => similarity(x, w) >= 0.6)) tally.set(w, (tally.get(w) || 0) + 1);
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function trackFor(session, speaker) {
  const f = fs.readdirSync(session).find((n) => n.endsWith('.ogg') && n.slice(n.indexOf('-') + 1, -4) === speaker);
  return f ? path.join(session, f) : null;
}

export function cutClip(track, win, outFile, run = spawnSync) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = run(
    'ffmpeg',
    ['-y', '-v', 'error', '-ss', win.start.toFixed(2), '-to', win.end.toFixed(2), '-i', track, '-ac', '1', '-c:a', 'aac', '-b:a', '40k', '-movflags', '+faststart', outFile],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${outFile}: ${r.stderr || r.error}`);
}

// ---------- candidates ----------

/** Name entries of the names check page (`### Word`, "Heard n time(s), also as: a, b", "Suggestion: X"). */
export function parseCheckPage(md) {
  const out = [];
  const names = (md.split('<!-- names -->')[1] || md).split('<!-- facts -->')[0];
  for (const block of names.split(/^### /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const word = lines[0].trim();
    if (!word || /^Answer/i.test(word)) continue;
    const also = /^Heard .*?also as:\s*(.+)$/m.exec(block)?.[1].split(/,\s*/).filter(Boolean) || [];
    const sug = /^Suggestion:\s*(.+)$/m.exec(block)?.[1].trim();
    out.push({ word, also, ...(sug ? { guess: { type: 'spelling', value: sug, from: 'pipeline' } } : {}) });
  }
  return out;
}

export function collectCandidates(session, extra = []) {
  const byKey = new Map();
  const add = (c) => {
    const k = c.word.toLowerCase();
    const old = byKey.get(k);
    if (!old) return byKey.set(k, { also: [], ...c });
    old.also = [...new Set([...old.also, ...(c.also || [])])];
    old.guess ||= c.guess;
    old.note ||= c.note;
  };
  const page = path.join(session, 'notes', 'Names and facts to check.en.md');
  if (fs.existsSync(page)) parseCheckPage(fs.readFileSync(page, 'utf8')).forEach(add);
  const nj = path.join(session, 'notes', 'notes.json');
  if (fs.existsSync(nj)) {
    const notes = JSON.parse(fs.readFileSync(nj, 'utf8'));
    for (const s of notes.scenes || [])
      for (const n of s.npcs || []) {
        const word = (n.name_en || n.name_da || '').trim();
        if (/^[\p{Lu}]/u.test(word) && !/\s/.test(word)) add({ word, also: [n.name_da, ...(n.aliases || [])].filter((x) => x && !/\s/.test(x) && x !== word) });
      }
  }
  extra.forEach(add);
  return [...byKey.values()];
}

// ---------- cards ----------

export function buildEntry(cand, order, timeline, cleaned, opts = {}) {
  const max = opts.max ?? 3;
  const terms = [cand.word, ...(cand.also || [])];
  const rx = termRegex(terms);
  const hits = [];
  for (const row of timeline) {
    const m = rx.exec(row.text || '');
    if (m) hits.push({ row, m });
  }
  const context = [];
  const cleanTexts = [];
  for (const { row, m } of spread(hits, max)) {
    const w = (row.words || []).find((x) => rx.test(String(x.word).replace(/[.,!?;:]+$/g, '')));
    const wStart = w ? w.start : row.start;
    const wEnd = w ? w.end : Math.min(row.end, row.start + 3);
    const a = m.index;
    const b = a + m[0].length;
    const item = {
      time: hms(wStart),
      speaker: row.player || row.speaker,
      before: (a > 90 ? '…' : '') + row.text.slice(Math.max(0, a - 90), a),
      hit: row.text.slice(a, b),
      after: row.text.slice(b, b + 90) + (row.text.length > b + 90 ? '…' : ''),
    };
    const c = cleanerLine(cleaned, row, wStart);
    if (c) {
      cleanTexts.push(c.text);
      item.clean = { time: hms(c.t), speaker: c.speaker, text: excerpt(c.text, [...terms, cand.guess?.value || ''].filter(Boolean)) };
    }
    item.win = clipWindow(wStart, wEnd, opts.lead ?? 6);
    item.track = row.speaker;
    context.push(item);
  }
  let guess = cand.guess;
  if (!guess) {
    const s = cleanerSpelling(terms, cleanTexts);
    if (s) guess = { type: 'spelling', value: s, from: 'cleaner' };
  }
  const variants = [...new Set(hits.map((h) => h.m[1]))];
  const note = cand.note || transcriptNote(cand.word, hits.length, variants, guess);
  return {
    kind: 'name',
    order,
    word: cand.word,
    note,
    suggestion: '',
    ...(guess ? { guess } : {}),
    context,
    heard: hits.length,
    also: (cand.also || []).join(', '),
  };
}

/** A note that says only what the transcript shows. */
export function transcriptNote(word, count, variants, guess) {
  if (!count) return `Not found in the raw transcript as ${word}.`;
  const bits = [`Heard ${count} time${count === 1 ? '' : 's'} in the raw transcript`];
  if (variants.length > 1) bits.push(`as ${variants.join(', ')}`);
  if (guess?.from === 'cleaner') bits.push(`; the cleaner wrote ${guess.value}`);
  return bits.join(' ') + '.';
}

// ---------- sweep ----------

function loadWordList(file) {
  return fs.existsSync(file)
    ? new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')))
    : new Set();
}

/**
 * Names the pipeline's own list missed: capitalised words in the middle of a cleaned sentence,
 * `fixes.json` corrections and low-confidence capitalised raw words that are on neither
 * `names.txt` nor a card. Plus pairs of cards that look like the same name.
 */
export function sweep(session, cards, cleaned, ordinary = new Set()) {
  const namesTxt = path.join(session, 'names.txt');
  const known = new Set(
    (fs.existsSync(namesTxt) ? fs.readFileSync(namesTxt, 'utf8').split(/\r?\n/) : []).flatMap((n) => [n.toLowerCase(), ...n.toLowerCase().split(/\s+/)]).filter(Boolean),
  );
  const onCard = new Set(cards.flatMap((c) => [c.word, ...(c.also ? c.also.split(/,\s*/) : [])]).map((x) => x.toLowerCase()));
  const found = new Map();
  const note = (w, why) => {
    const k = w.toLowerCase();
    if (known.has(k) || onCard.has(k) || ordinary.has(k) || w.length < 3 || /^(i|you|we|they|he|she|it)['’](m|d|ll|ve|re|s)$/.test(k)) return;
    const e = found.get(k) || { word: w, count: 0, why: new Set() };
    e.count += 1;
    e.why.add(why);
    found.set(k, e);
  };
  for (const c of cleaned)
    for (const m of c.text.matchAll(/(?<=[^.!?*\s]\s+|[,;:]\s*)([\p{Lu}][\p{L}'’-]{2,})/gu)) note(m[1].replace(/['’]s$/, ''), 'capitalised in a cleaned line');
  const fx = path.join(session, 'timeline', 'fixes.json');
  if (fs.existsSync(fx)) for (const a of JSON.parse(fs.readFileSync(fx, 'utf8')).applied || []) if (a.correct && /^\p{Lu}/u.test(a.correct)) note(a.correct, 'corrected by fixes.json');
  const lc = path.join(session, 'timeline', 'low_confidence.jsonl');
  if (fs.existsSync(lc))
    for (const l of fs.readFileSync(lc, 'utf8').split(/\r?\n/)) {
      if (!l.trim()) continue;
      const w = String(JSON.parse(l).word || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (/^\p{Lu}/u.test(w) && w.length >= 4) note(w, 'low-confidence raw word');
    }
  const outside = [...found.values()].map((e) => ({ word: e.word, count: e.count, why: [...e.why] })).sort((a, b) => b.count - a.count);
  const duplicates = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const A = [cards[i].word, ...(cards[i].also ? cards[i].also.split(/,\s*/) : [])];
      const B = [cards[j].word, ...(cards[j].also ? cards[j].also.split(/,\s*/) : [])];
      const pair = A.flatMap((a) => B.map((b) => [a, b])).find(([a, b]) => similar(a, b));
      if (pair) duplicates.push({ a: cards[i].word, b: cards[j].word, because: pair.join(' ~ ') });
    }
  return { outside, duplicates };
}

/** Two spellings that may be one name: close edit distance, or one starts with the other. */
export function similar(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 3 && l.startsWith(s)) return true;
  return Math.min(x.length, y.length) >= 4 && similarity(x, y) >= 0.65;
}

// ---------- page ----------

const html = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function knownNames(session) {
  const f = path.join(session, 'names.txt');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

/** Fill the page template: the title and the suggestions list (names.txt). Escaped; no session data besides names. */
export function renderPage(template, title, names) {
  return template
    .replaceAll('{{TITLE}}', html(title))
    .replace('{{OPTIONS}}', names.map((n) => `<option value="${html(n)}">`).join(''));
}

// ---------- CLI ----------

export function resolveSession(arg, env = process.env) {
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return path.resolve(arg);
  const base = env.FVTT_SESSIONS_DIR || (env.FVTT_DATA_DIR ? path.join(env.FVTT_DATA_DIR, 'FoundrySessions') : path.join(os.homedir(), 'Documents', 'FoundrySessions'));
  return path.join(base, arg);
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-clips') args.noClips = true;
    else if (['--candidates', '--out', '--max', '--lead', '--title'].includes(a)) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  if (!args._[0]) {
    console.error('usage: node scripts/names-check.mjs <session> [--candidates file.json] [--out dir] [--no-clips] [--max 3] [--lead 6]');
    return 2;
  }
  const session = resolveSession(args._[0]);
  const out = args.out ? path.resolve(args.out) : path.join(session, 'notes', 'names-check');
  const extra = args.candidates ? JSON.parse(fs.readFileSync(args.candidates, 'utf8')) : [];
  const timeline = loadTimeline(session);
  const cleanedPath = path.join(session, 'notes', 'transcript.en.md');
  const cleaned = fs.existsSync(cleanedPath) ? parseCleaned(fs.readFileSync(cleanedPath, 'utf8')) : [];
  const cands = collectCandidates(session, extra);
  const opts = { max: args.max ? +args.max : 3, lead: args.lead ? +args.lead : 6 };
  for (const d of ['entries', 'clips']) fs.rmSync(path.join(out, d), { recursive: true, force: true }); // a rebuild leaves no stale cards or clips
  fs.mkdirSync(path.join(out, 'entries'), { recursive: true });
  const cards = [];
  let clips = 0;
  cands.forEach((c, i) => {
    const e = buildEntry(c, i + 1, timeline, cleaned, opts);
    for (const item of e.context) {
      const win = item.win;
      const track = trackFor(session, item.track);
      delete item.win;
      delete item.track;
      if (args.noClips || !track) continue;
      const fn = `c-name-${i + 1}-${item.time.replace(/:/g, '')}.mp4`;
      cutClip(track, win, path.join(out, 'clips', fn));
      item.clipfile = fn;
      clips += 1;
    }
    cards.push(e);
    fs.writeFileSync(path.join(out, 'entries', `name-${i + 1}.json`), JSON.stringify({ id: `name-${i + 1}`, ...e }));
  });
  const ordinary = new Set([...loadWordList(path.join(HERE, '..', 'tools', 'session-pipeline', 'src', 'session_pipeline', 'data', 'words_en.txt')), ...loadWordList(path.join(HERE, '..', 'tools', 'session-pipeline', 'src', 'session_pipeline', 'data', 'words_da.txt'))]);
  const sw = sweep(session, cards, cleaned, ordinary);
  fs.writeFileSync(path.join(out, 'sweep.json'), JSON.stringify(sw, null, 1));
  fs.writeFileSync(path.join(out, 'page.html'), renderPage(fs.readFileSync(path.join(HERE, 'names-check-page.html'), 'utf8'), args.title || 'Names check', knownNames(session)));
  console.log(`names-check: ${cards.length} cards, ${clips} clips -> ${out}`);
  console.log(`sweep: ${sw.outside.length} names outside the list, ${sw.duplicates.length} possible duplicates (sweep.json)`);
  for (const d of sw.duplicates) console.log(`  duplicate? ${d.a} / ${d.b} (${d.because})`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
