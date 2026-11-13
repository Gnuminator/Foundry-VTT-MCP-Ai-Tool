// @ts-check
import path from 'node:path';

/** Merges allowed on the module, the bridge link or guarded writes between two live round trips. */
export const TRAIN_SIZE = 4;

/** The remote and branch the gate trusts. */
export const REMOTE = 'aitool';

/** The silent #pr-log post after a merge: the sender lives in the bot package, plain Node. */
export const ANNOUNCE_SCRIPT = path.join('packages', 'discord-bot', 'announce', 'announce.mjs');

export const ANNOUNCE_TIMEOUT_MS = 10_000;

export const MAIN = `${REMOTE}/main`;

/** Where the branch ruleset lives. */
export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';

/** Lines of a failed log that are printed. */
export const TAIL_LINES = 30;

/** --wait-ci: how long to wait for CI, and how often to ask GitHub. */
export const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export const WAIT_POLL_MS = 30 * 1000;

/** --wait-ci: GitHub answering with an error this many polls in a row ends the wait. */
export const WAIT_MAX_ERRORS = 3;

/** The ci.yml job that stands for every job; main's ruleset must require it once a merge queue is on. */
export const AGGREGATE_CHECK = 'ci-all-green';

/** GraphQL for one PR's merge queue state (gh pr view has no such field). @param {number} pr */
export const queueQuery = pr =>
  `query{repository(owner:"${REPO.split('/')[0]}",name:"${REPO.split('/')[1]}"){pullRequest(number:${pr}){state isInMergeQueue mergeCommit{oid}}}}`;

/** A single gh call (spawnSync timeout). */
export const GH_TIMEOUT_MS = 120_000;

/** One git call on the vault (pull, commit, push) for the merge train note. */
export const VAULT_GIT_TIMEOUT_MS = 60_000;

/** Exit codes of the wait (the gate itself: 0 merged or OK, 1 refused, 2 usage). */
export const EXIT_CI_FAILED = 3;

export const EXIT_HEAD_MOVED = 4;

export const EXIT_WAIT_TIMEOUT = 5;

/** The relaunched copy (from main) must not relaunch again; it also knows main was just fetched. */
export const ENV_FROM_MAIN = 'LANE_MERGE_FROM_MAIN';

export const ENV_FETCHED = 'LANE_MERGE_FETCHED';

export const PR_FIELDS =
  'number,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,files,statusCheckRollup,title,body';
