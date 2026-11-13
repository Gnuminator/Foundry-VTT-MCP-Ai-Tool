// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { REMOTE, MAIN } from './constants.mjs';
import { firstLine } from './run.mjs';

/**
 * @typedef {{ head: string | null, verdict: string | null, merge: boolean }} VerdictEntry
 * @typedef {{ name: string, entries: VerdictEntry[], shortHeads: string[], opus: boolean, malformed: string[] }} ReviewNote
 */

/** The verdict text, without bold markers, a trailing full stop or case. @param {string} text */
export const verdictKey = text =>
  text
    .replace(/\*\*/g, '')
    .replace(/[.\s]+$/, '')
    .trim()
    .toLowerCase();

/**
 * What a review note says. A note can hold several rounds: every `## Verdict` section is one entry,
 * tied to the last `Head reviewed:` line above it. `Head reviewed:` must carry the full 40-character
 * sha (backticked or bare, prose may follow); a shorter sha is listed in `shortHeads` and ties
 * nothing. The verdict is the text after `Verdict` on the heading line (`## Verdict: Do not merge`),
 * else the first bold text of the section. `opus` is true only for a file named
 * `<N>-opus-review...` or a first `# ` heading that starts `PR #<N> Opus review`.
 * The order is part of the format: each `## Verdict` needs a `Head reviewed:` line between it and the
 * previous verdict (or the top of the note), and no `Head reviewed:` line may follow the last
 * verdict. Otherwise a verdict would tie to an older round's sha, so the note is `malformed` (and
 * the entry ties to nothing). More rules: a `Head reviewed:` line counts only at the start of a
 * line (an optional bullet and bold markers allowed), never inside prose; `Head reviewed:` on
 * the `## Verdict` line itself is malformed; a section with no verdict text is an entry that is not
 * a Merge; and two distinct full shas on `Head reviewed:` lines before one verdict are malformed.
 * @param {string} name @param {string} text @param {number} prNumber
 * @returns {ReviewNote}
 */
export function parseReviewNote(name, text, prNumber) {
  const lines = text.split(/\r?\n/);
  /** @type {string | null} */
  let head = null;
  /** @type {VerdictEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const shortHeads = [];
  /** @type {string[]} */
  const malformed = [];
  /** Line number (1-based) of the first Head reviewed line since the last verdict, else 0. */
  let headSince = 0;
  /** The full shas named since the last verdict. @type {Set<string>} */
  let headsSince = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const v = /^##\s+Verdict\b(.*)$/i.exec(line);
    // A Head reviewed line starts the line (a bullet or bold marker may come first); a mention in
    // prose does not move the tie.
    const h = /^\s*(?:[-*]\s+)?(?:\*\*)?Head reviewed:(?:\*\*)?\s*`?([0-9a-f]+)(?![0-9a-z])/i.exec(
      line
    );
    if (h && !v) {
      headSince ||= i + 1;
      if (h[1].length === 40) {
        head = h[1].toLowerCase();
        headsSince.add(head);
      } else {
        head = null;
        shortHeads.push(h[1].toLowerCase());
      }
      continue;
    }
    if (!v) continue;
    if (/Head reviewed:/i.test(line)) {
      malformed.push(
        `the ## Verdict on line ${i + 1} also carries "Head reviewed:"; put it on its own line above`
      );
    }
    if (headsSince.size > 1) {
      malformed.push(
        `more than one full sha is named by "Head reviewed:" above the ## Verdict on line ${i + 1}`
      );
    }
    headsSince = new Set();
    if (headSince === 0) {
      malformed.push(
        `the ## Verdict on line ${i + 1} has no "Head reviewed:" line above it since the previous verdict`
      );
      head = null;
    }
    headSince = 0;
    let verdict = v[1].replace(/^[\s:\-\u2013]+/, '').trim() || null;
    if (verdict === null) {
      const section = [];
      for (const l of lines.slice(i + 1)) {
        if (/^#{1,2}\s/.test(l)) break;
        section.push(l);
      }
      const bold = /\*\*(.+?)\*\*/.exec(section.join('\n'));
      verdict = bold ? bold[1].trim() : null;
    }
    entries.push({ head, verdict, merge: verdict !== null && verdictKey(verdict) === 'merge' });
  }
  if (headSince > 0) {
    malformed.push(
      entries.length > 0
        ? `the "Head reviewed:" on line ${headSince} comes after the last ## Verdict`
        : `the "Head reviewed:" on line ${headSince} has no ## Verdict (a ### heading does not count)`
    );
  }
  if (headsSince.size > 1) {
    malformed.push('more than one full sha is named by "Head reviewed:" after the last verdict');
  }
  const heading = lines.find(l => /^#\s+/.test(l)) ?? '';
  return {
    name,
    entries,
    shortHeads,
    malformed,
    opus:
      new RegExp(`^${prNumber}-opus-review`, 'i').test(name) ||
      new RegExp(`^#\\s+PR\\s+#${prNumber}\\s+Opus review`, 'i').test(heading),
  };
}

/**
 * Review notes of one PR: the "Reviews ..." folders under Handoff, files named <N>-*review*.md.
 * Null when the vault folder does not exist.
 * @param {string} vault @param {number} prNumber
 * @returns {ReviewNote[] | null}
 */
export function findReviewNotes(vault, prNumber) {
  const handoff = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  if (!fs.existsSync(vault)) return null;
  if (!fs.existsSync(handoff)) return [];
  const prefix = `${prNumber}-`;
  /** @type {ReviewNote[]} */
  const notes = [];
  for (const dir of fs.readdirSync(handoff, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('Reviews ')) continue;
    const folder = path.join(handoff, dir.name);
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith('.md') || !file.startsWith(prefix) || !/review/i.test(file)) continue;
      notes.push(parseReviewNote(file, fs.readFileSync(path.join(folder, file), 'utf8'), prNumber));
    }
  }
  return notes;
}

/**
 * The helper command a refusal about a review note ends with, the PR number filled in.
 * @param {number | null} [prNumber]
 */
export function reviewNoteCommand(prNumber) {
  return `write it with: node scripts/review-note.mjs ${prNumber ?? '<PR>'} --verdict <merge|fixes|no> --model <opus|sonnet> --body <reviewer text file>`;
}

/**
 * The naming rule the gate reads notes by, and the helper that writes one, for a refusal that found none.
 * @param {number} prNumber
 */
export function reviewNamingRule(prNumber) {
  return (
    `the gate reads files named ${prNumber}-*review*.md in a "Handoff/Reviews <date>/" folder ` +
    `(for a risky PR, named ${prNumber}-opus-review... or headed "# PR #${prNumber} Opus review"), ` +
    'each with a "Head reviewed:" line holding the full 40-character sha above "## Verdict"'
  );
}

/**
 * Files in the "Reviews ..." folders that start with `<N>-` but are not read as review notes
 * because "review" is not in the name. Empty when the vault or Handoff folder is missing.
 * @param {string} vault @param {number} prNumber
 * @returns {string[]}
 */
export function unreadPrNotes(vault, prNumber) {
  const handoff = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  if (!fs.existsSync(handoff)) return [];
  /** @type {string[]} */
  const out = [];
  for (const dir of fs.readdirSync(handoff, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('Reviews ')) continue;
    for (const file of fs.readdirSync(path.join(handoff, dir.name))) {
      if (file.endsWith('.md') && file.startsWith(`${prNumber}-`) && !/review/i.test(file)) {
        out.push(`${dir.name}/${file}`);
      }
    }
  }
  return out.sort();
}

/**
 * The Opus notes that give a verdict for this head (any verdict), for the risky notice: it says
 * whether the Opus review it asks for is there. Mirrors judgeReviews: `opus` plus an entry tied to
 * the full head sha, or to a sha whose verdict carries to the head (`carried`).
 * @param {ReviewNote[]} notes @param {string} headSha @param {string[]} [carried]
 * @returns {string[]}
 */
export function opusNotesForHead(notes, headSha, carried = []) {
  const head = headSha.toLowerCase();
  const tied = (/** @type {string | null} */ h) => h === head || (!!h && carried.includes(h));
  return notes.filter(n => n.opus && n.entries.some(e => tied(e.head))).map(n => n.name);
}

/**
 * The `git patch-id --verbatim` of a PR's own patch at one commit: the diff from its merge base
 * with main to the commit. Equal ids at two commits mean the PR changes exactly the same lines
 * (whitespace counts; the order of files and hunks and the line numbers do not), so a clean merge
 * of main into the branch or a rebase without changes keeps the id, and a conflict resolution or
 * any edit of the PR's lines changes it. Plain `git` from the current folder, explicit shas only.
 * A commit this clone lacks is fetched from the remote once. Every problem is an error, never an id.
 * @param {(cmd: string, args: string[], input?: string) => { status: number, stdout: string, stderr: string }} run
 * @param {string} sha full commit sha @param {string} [mainRef]
 * @returns {{ id: string } | { error: string }}
 */
export function patchIdAt(run, sha, mainRef = MAIN) {
  const s = sha.slice(0, 7);
  const why = (/** @type {{ stderr: string, stdout: string }} */ r) =>
    firstLine(r.stderr || r.stdout) || 'failed';
  if (!/^[0-9a-f]{40}$/.test(sha)) return { error: `${sha} is not a full commit sha` };
  const isCommit = () => run('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
  if (!isCommit()) {
    const f = run('git', ['fetch', '-q', REMOTE, sha]);
    if (f.status !== 0 || !isCommit()) {
      return { error: `commit ${s} is not in this clone and cannot be fetched (${why(f)})` };
    }
  }
  const base = run('git', ['merge-base', mainRef, sha]);
  const baseSha = base.stdout.trim();
  if (base.status !== 0 || !/^[0-9a-f]{40}$/.test(baseSha)) {
    return { error: `no merge base of ${s} with ${mainRef} (${why(base)})` };
  }
  // Fixed flags, so local diff settings (renames, prefixes, drivers) cannot change the patch text.
  const diff = run('git', [
    'diff',
    '--binary',
    '--full-index',
    '--no-renames',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--submodule=short',
    '--ignore-submodules=none',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    baseSha,
    sha,
  ]);
  if (diff.status !== 0) return { error: `git diff for ${s} failed (${why(diff)})` };
  if (diff.stdout.trim() === '') return { error: `the patch at ${s} is empty` };
  const pid = run('git', ['patch-id', '--verbatim'], diff.stdout);
  const id = /^([0-9a-f]{40})\s/.exec(pid.stdout)?.[1];
  if (pid.status !== 0 || !id) return { error: `git patch-id for ${s} failed (${why(pid)})` };
  return { id };
}

/**
 * Which reviewed commits carry their verdicts to the head: those whose PR patch id equals the
 * head's (patchIdAt). Every full sha any note names is compared, so a Do not merge on the same
 * patch carries too; and a reviewed commit with another patch that is newer (committer time) than
 * every carried one, or that a note lists after its carried entries, refuses the carry, so a later
 * commit's review is never skipped. Any error (a shallow clone, a commit that cannot be fetched,
 * a failing git) returns the error as `carryError` and carries nothing. The result is judgeReviews' `carry`.
 * @param {(cmd: string, args: string[], input?: string) => { status: number, stdout: string, stderr: string }} run
 * @param {ReviewNote[]} notes @param {string} headSha @param {string} [mainRef]
 * @returns {{ carried: string[], carryError: string | null }}
 */
export function carriedReviews(run, notes, headSha, mainRef = MAIN) {
  const head = headSha.toLowerCase();
  const reviewed = [
    ...new Set(notes.flatMap(n => n.entries.map(e => e.head)).filter(h => h && h !== head)),
  ];
  if (reviewed.length === 0) return { carried: [], carryError: null };
  const fail = (/** @type {string} */ carryError) => ({ carried: [], carryError });
  const shallow = run('git', ['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') {
    return fail(
      shallow.status === 0
        ? 'this clone is shallow (git fetch --unshallow first)'
        : 'git rev-parse failed'
    );
  }
  const at = patchIdAt(run, head, mainRef);
  if ('error' in at) return fail(at.error);
  /** @type {string[]} */
  const carried = [];
  /** Committer time of each reviewed commit (seconds). @type {Map<string, number>} */
  const time = new Map();
  for (const sha of /** @type {string[]} */ (reviewed)) {
    const r = patchIdAt(run, sha, mainRef);
    if ('error' in r) return fail(r.error);
    if (r.id === at.id) carried.push(sha);
    const t = run('git', ['show', '-s', '--format=%ct', sha]);
    const seconds = Number(t.stdout.trim());
    if (t.status !== 0 || !/^\d+$/.test(t.stdout.trim())) {
      return fail(`cannot read the commit time of ${sha.slice(0, 7)}`);
    }
    time.set(sha, seconds);
  }
  // Only the newest review counts (the brief: the newest counting note's sha). A reviewed commit with
  // another patch that is as new as or newer than every carried one (a later change that was reviewed,
  // maybe vetoed, then dropped again) refuses the carry. A tie counts as newer.
  if (carried.length > 0) {
    const newestCarried = Math.max(...carried.map(s => /** @type {number} */ (time.get(s))));
    const later = reviewed.filter(
      s =>
        !carried.includes(/** @type {string} */ (s)) &&
        /** @type {number} */ (time.get(/** @type {string} */ (s))) >= newestCarried
    );
    if (later.length > 0) {
      const names = later.map(s => /** @type {string} */ (s).slice(0, 7)).join(', ');
      return fail(`the newest reviewed commit (${names}) has a different patch from the head`);
    }
  }
  // The order inside a note is reliable where committer times are not (clock skew, a force-push back
  // to an older commit): an entry for another patch listed after a carried entry refuses the carry.
  if (carried.length > 0) {
    for (const n of notes) {
      const last = n.entries.reduce((k, e, i) => (e.head && carried.includes(e.head) ? i : k), -1);
      const after = n.entries
        .slice(last + 1)
        .filter(e => e.head && e.head !== head && !carried.includes(e.head));
      if (last >= 0 && after.length > 0) {
        const names = after.map(e => /** @type {string} */ (e.head).slice(0, 7)).join(', ');
        return fail(`${n.name} lists ${names} (a different patch) after the carried review`);
      }
    }
  }
  return { carried, carryError: null };
}

/**
 * Do the review notes clear this head commit? Every verdict any note gives for the head must be
 * Merge (a Merge after fixes or Do not merge in any note refuses), at least one must be a Merge,
 * and when the PR is risky at least one Merge must come from an Opus review. When no note names the
 * head, the verdicts for the `carried` shas (carriedReviews: the same patch) stand in for it, under
 * the same rules; `carriedFrom` lists the shas that cleared it.
 * @param {ReviewNote[]} notes @param {string} headSha @param {boolean} needOpus
 * @param {{ carried?: string[], carryError?: string | null }} [carry]
 * @param {number | null} [prNumber] fills the helper command every refusal but the veto ends with
 * @returns {{ ok: boolean, detail: string, carriedFrom?: string[] }}
 */
export function judgeReviews(notes, headSha, needOpus, carry = {}, prNumber = null) {
  const helper = `; ${reviewNoteCommand(prNumber)}`;
  const head = headSha.toLowerCase();
  const short = head.slice(0, 7);
  const bad = notes.filter(n => n.malformed.length > 0);
  if (bad.length > 0) {
    const said = bad.map(n => `${n.name} is malformed: ${n.malformed.join('; ')}`);
    return {
      ok: false,
      detail: `${said.join('; ')} (put "Head reviewed:" before each "## Verdict", nothing after the last)${helper}`,
    };
  }
  // A verdict under a short sha ties to nothing, so it could hide a Do not merge for this head.
  const shortHit = notes.flatMap(n =>
    n.shortHeads
      .filter(s => head.startsWith(s))
      .map(s => `${n.name} reviewed ${s} (Head reviewed needs the full 40-character sha)`)
  );
  if (shortHit.length > 0) {
    return {
      ok: false,
      detail: `${shortHit.join('; ')}; it could hide a verdict for head ${short}${helper}`,
    };
  }
  const named = notes.flatMap(note =>
    note.entries.filter(e => e.head === head).map(entry => ({ note, entry }))
  );
  let carriedShas = named.length === 0 ? (carry.carried ?? []) : [];
  let carryError = carry.carryError;
  // A short sha ties to no commit, so on the carry path it could hide a verdict on the same patch
  // (a commit no note names in full): any short sha in any note turns the carry off.
  const shortNamed = notes
    .filter(n => n.shortHeads.length > 0)
    .map(n => `${n.name} reviewed ${n.shortHeads.join(', ')}`);
  if (carriedShas.length > 0 && shortNamed.length > 0) {
    carriedShas = [];
    carryError = `${shortNamed.join('; ')} by a short sha, which could hide a verdict on the same patch (Head reviewed needs the full 40-character sha)`;
  }
  const forHead =
    named.length > 0
      ? named
      : notes.flatMap(note =>
          note.entries
            .filter(e => !!e.head && carriedShas.includes(e.head))
            .map(entry => ({ note, entry }))
        );
  const carriedFrom = [...new Set(forHead.map(x => /** @type {string} */ (x.entry.head)))];
  const via = named.length > 0 ? '' : ` (verdict carried from ${carriedFrom.join(', ')})`;
  if (forHead.length === 0) {
    const reviewedOther = notes.some(n => n.entries.some(e => e.head && e.head !== head));
    const notCarried = carryError
      ? `; not carried: ${carryError}; a review note for the head is needed`
      : reviewedOther && carry.carried
        ? '; not carried: the patch changed since every reviewed commit; a review note for the head is needed'
        : '';
    const seen = notes.map(n => {
      const heads = [...new Set(n.entries.map(e => e.head).filter(Boolean))].map(h =>
        /** @type {string} */ (h).slice(0, 7)
      );
      const tooShort = n.shortHeads.map(
        h => `${h} (Head reviewed needs the full 40-character sha)`
      );
      return `${n.name} reviewed ${[...heads, ...tooShort].join(', ') || 'no head'}`;
    });
    return {
      ok: false,
      detail: `no review note for head ${short}${seen.length ? ` (found ${seen.join('; ')})` : ''}${notCarried}${helper}`,
    };
  }
  const blocking = forHead.filter(x => !x.entry.merge);
  if (blocking.length > 0) {
    const said = blocking.map(x => `${x.note.name} says "${x.entry.verdict ?? 'no verdict'}"`);
    return {
      ok: false,
      detail: `${said.join('; ')} for head ${short}${via}; every review must say Merge`,
    };
  }
  if (needOpus && !forHead.some(x => x.note.opus)) {
    const names = [...new Set(forHead.map(x => x.note.name))].join(', ');
    return {
      ok: false,
      detail: `only a Sonnet review (${names}) says Merge for ${short}${via}, and this PR needs an Opus review${helper}`,
    };
  }
  return {
    ok: true,
    detail: forHead.map(x => x.note.name).join(', '),
    ...(named.length > 0 ? {} : { carriedFrom }),
  };
}
