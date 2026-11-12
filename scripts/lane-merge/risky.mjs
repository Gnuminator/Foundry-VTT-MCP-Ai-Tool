// @ts-check

/**
 * Areas where a Sonnet review is not enough (D-101): the counting review note must be an Opus
 * review. Patterns are repo-relative, `/` separated: `**` crosses folders, `*` does not. The test
 * file checks that every pattern still matches a tracked file.
 * @type {{ name: string, patterns: string[] }[]}
 */
export const RISKY_CATEGORIES = [
  {
    // Guarded writes: plan, apply and undo, in the module, the server and the shared contract.
    // queries.ts holds the module handlers that call into guarded-write.
    name: 'guarded writes',
    patterns: [
      'packages/foundry-module/src/data-access/guarded-write*',
      'packages/foundry-module/src/live-plan*',
      'packages/foundry-module/src/transaction-manager*',
      'packages/foundry-module/src/guarded-features*',
      'packages/foundry-module/src/change-journal*',
      'packages/foundry-module/src/queries.ts',
      'packages/mcp-server/src/guarded-write/**',
      'packages/mcp-server/src/tools/guarded-changes*',
      'packages/mcp-server/src/tools/modules/guarded-changes*',
      'packages/mcp-server/src/change-journal-pump*',
      'shared/src/guarded-write*',
      'shared/src/change-journal*',
    ],
  },
  {
    // The bridge link: the module's socket to the server and the server's connection and control channel.
    name: 'the bridge link',
    patterns: [
      'packages/foundry-module/src/bridge-link*',
      'packages/foundry-module/src/bridge-handlers*',
      'packages/foundry-module/src/socket-bridge*',
      'packages/mcp-server/src/foundry-client*',
      'packages/mcp-server/src/foundry-connector*',
      'packages/mcp-server/src/control-*',
      'packages/mcp-server/src/session-control*',
      'packages/mcp-server/src/standalone.ts',
      'packages/cogm-dashboard/src/feed/mcp-control-client*',
    ],
  },
  {
    // The write gate: what may change the world, and who may.
    name: 'the write gate',
    patterns: [
      'packages/foundry-module/src/write-gate*',
      'packages/foundry-module/src/permissions*',
    ],
  },
  {
    // Security: dashboard auth (server and React side) and redaction, secret stripping, the
    // licensed-content guard, secret terms, the player vault writer, and the React side of guarded
    // changes (its confirm step).
    name: 'security',
    patterns: [
      'packages/cogm-dashboard/src/auth*',
      'packages/cogm-dashboard/src/redact*',
      'packages/cogm-dashboard/src/player-vault/writer*',
      'packages/cogm-dashboard/web/src/lib/auth*',
      'packages/cogm-dashboard/web/src/lib/guarded*',
      'packages/mcp-server/src/secret-terms*',
      'packages/mcp-server/src/handouts/strip-secrets*',
      'packages/mcp-server/src/obsidian/licensed-guard*',
      '.claude/hooks/guard-*',
    ],
  },
  {
    // Pi scripts: they run as root on the Pi and change the real campaign host.
    name: 'Pi scripts',
    // The Discord announce sender runs with the bot token from Pi stage 5 and after every merge.
    patterns: [
      'scripts/pi/**',
      'scripts/plan-b/**',
      'deploy/**',
      'packages/discord-bot/announce/**',
    ],
  },
  {
    // Wire contracts: the named contract files of the shared package and the module manifest. A new
    // shared/src file must be listed here or in the test's NOT_CONTRACT list (the test enforces it).
    name: 'wire contracts',
    patterns: [
      'shared/src/protocol*',
      'shared/src/schemas*',
      'shared/src/constants*',
      'shared/src/bridge-queries*',
      'shared/src/types*',
      'shared/src/version*',
      'shared/src/ports*',
      // Tool modules, the sets and budgets that expose them, and the player preset's tools: a tool's
      // name, schema and set decide what Claude can call (PR 848 slipped past without these).
      'packages/mcp-server/src/tools/modules/**',
      'packages/mcp-server/src/tool-sets.ts',
      'packages/mcp-server/src/tool-budgets.ts',
      'packages/mcp-server/src/tools/player.ts',
      'packages/foundry-module/module.json',
    ],
  },
];

/**
 * The Opus list as lines, printed by `npm run lane:risky`; CLAUDE.md points at it.
 * @returns {string[]}
 */
export function riskyListLines() {
  return RISKY_CATEGORIES.flatMap(c => [`${c.name}:`, ...c.patterns.map(p => `  ${p}`)]);
}

/**
 * PRs that touch these join the merge train (D-121): the Foundry module, the bridge link or guarded
 * writes. Tests do not count. A subset of RISKY_CATEGORIES plus the whole module package.
 * @type {string[]}
 */
export const TRAIN_PATTERNS = [
  'packages/foundry-module/**',
  ...RISKY_CATEGORIES.filter(
    c => c.name === 'guarded writes' || c.name === 'the bridge link'
  ).flatMap(c => c.patterns),
];

/** @param {string} file */
export const isTestFile = file => /\.(test|spec)\.[cm]?[jt]sx?$|\/test-support\//.test(file);

/** A glob (`**`, `*`, `?`) as a regular expression over a whole repo-relative path. @param {string} glob */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** @param {string} file @param {string[]} patterns */
export function matchesAny(file, patterns) {
  const f = file.replace(/\\/g, '/');
  return patterns.some(p => globToRegExp(p).test(f));
}

/**
 * The risky categories a set of changed files falls in, each with its first file.
 * @param {string[]} files
 * @returns {{ name: string, file: string }[]}
 */
export function riskyHits(files) {
  /** @type {{ name: string, file: string }[]} */
  const hits = [];
  for (const cat of RISKY_CATEGORIES) {
    const file = files.find(f => matchesAny(f, cat.patterns));
    if (file) hits.push({ name: cat.name, file });
  }
  return hits;
}

/** @param {string[]} files */
export function isTrainRelevant(files) {
  return files.some(f => !isTestFile(f) && matchesAny(f, TRAIN_PATTERNS));
}
