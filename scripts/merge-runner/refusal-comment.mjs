// @ts-check
/**
 * A refusal the app's PR monitor cannot see (drift, review, visual, a head that moved) is written
 * on the PR as one comment, so a lane that bound its PR with the monitor on is woken inside the
 * cache hour instead of finding the Backlog line much later. One comment per head (the marker holds
 * the head sha), the refusal line only, and nothing on a merge. This is the app waking a lane; the
 * runner messages no session.
 */

/** @param {string} head */
export const refusalMarker = head => `<!-- merge-runner-refusal ${head} -->`;

/** @param {string} s @param {number} max */
const oneLine = (s, max) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The comment is public: a local absolute path (a gate log in the temp folder, a vault file) shows
 * only its last segment.
 * @param {string} s
 */
export const noPaths = s =>
  s.replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users|tmp|var)\/)[^\s)]*[\\/]([^\s\\/)]+)/g, '$1');

/**
 * @param {{ gh: (args: string[]) => { status: number, stdout: string }, log: (l: string) => void }} d
 * @param {string} repo
 * @param {{ pr: number, head: string }} r
 * @param {string} reason
 * @returns {boolean} true when a comment was written
 */
export function commentRefusal(d, repo, r, reason) {
  try {
    const marker = refusalMarker(r.head);
    const seen = d.gh(['pr', 'view', String(r.pr), '-R', repo, '--json', 'comments']);
    if (seen.status === 0) {
      try {
        /** @type {{ comments?: { body?: string }[] }} */
        const j = JSON.parse(seen.stdout);
        if ((j.comments ?? []).some(c => String(c.body ?? '').includes(marker))) return false;
      } catch {
        /* unreadable: comment anyway */
      }
    }
    const body = `${marker}\nMerge runner: not merged on head ${r.head.slice(0, 7)}: ${oneLine(noPaths(reason), 300)}`;
    const res = d.gh(['pr', 'comment', String(r.pr), '-R', repo, '--body', body]);
    if (res.status !== 0) d.log(`WARNING: refusal comment on #${r.pr} not written`);
    return res.status === 0;
  } catch {
    return false;
  }
}
