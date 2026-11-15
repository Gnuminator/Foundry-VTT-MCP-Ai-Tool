// @ts-check
import { lf } from './run.mjs';

/** Does the PR add or change a `changelog.d/*.md` fragment (not the README)? @param {{ path: string, changeType?: string }[]} files */
export function hasChangelogFragment(files) {
  return files.some(
    f =>
      /^changelog\.d\/[^/]+\.md$/.test(f.path.replace(/\\/g, '/')) &&
      !/(^|\/)README\.md$/i.test(f.path) &&
      String(f.changeType ?? '').toUpperCase() !== 'DELETED'
  );
}

/** Every place scripts/sync-version.mjs stamps the version, and what may change there. */
export const VERSION_JSON = [
  'package.json',
  'shared/package.json',
  'packages/cogm-dashboard/package.json',
  'packages/discord-bot/package.json',
  'packages/foundry-module/package.json',
  'packages/mcp-server/package.json',
  'packages/obsidian-plugin/package.json',
  'packages/foundry-module/module.json',
  'packages/obsidian-plugin/manifest.json',
];

export const SEMVER_RE = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';

/** Text files with a version line: every changed line must be one of these, on both sides. */
export const VERSION_TEXT = {
  // Group 1 is the version; the rest of the line must be identical at the base and the head.
  'shared/src/version.ts': [new RegExp(`^export const TOOL_VERSION = '(${SEMVER_RE})';$`, 'd')],
  'installer/nsis/foundry-mcp-server.nsi': [
    new RegExp(`^\\s*!define VERSION "v(${SEMVER_RE})"$`, 'd'),
    new RegExp(`^\\s*WriteRegStr HKCU "[^"]+" "DisplayVersion" "(${SEMVER_RE})"$`, 'd'),
  ],
};

export const isVersion = (/** @type {unknown} */ v) =>
  typeof v === 'string' && new RegExp(`^${SEMVER_RE}$`).test(v);

/** Parsed JSON or undefined. @param {string | null} text */
export const jsonOf = text => {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * The same JSON once the version fields are blanked: the top-level `version`, and in
 * package-lock.json the root's and each workspace entry's (the entries sync-version stamps).
 * The versions come back keyed (`version` for the top level, the package key for a lock entry), so
 * a version that moves from one entry to another is not mistaken for a bump.
 * @param {string} file @param {any} data
 * @returns {{ data: any, versions: Map<string, unknown> } | null}
 */
export function withoutVersions(file, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const copy = structuredClone(data);
  const versions = new Map([['version', copy.version]]);
  delete copy.version;
  if (file === 'package-lock.json') {
    for (const [key, entry] of Object.entries(copy.packages ?? {})) {
      const own =
        key === '' ||
        key === 'shared' ||
        (key.startsWith('packages/') && !key.includes('node_modules'));
      if (own && entry && typeof entry === 'object' && 'version' in entry) {
        versions.set(`packages:${key}`, entry.version);
        delete entry.version;
      }
    }
  }
  return { data: copy, versions };
}

/** Deep equality of two parsed JSON values. @param {any} a @param {any} b @returns {boolean} */
export function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

/**
 * Is this a release PR (docs/dev/RELEASING.md steps 1 and 2), which folds the fragments instead of
 * adding one? Strict: CHANGELOG.md changes, the root package.json version changes, and every other
 * file is a deleted changelog.d fragment or a place sync-version stamps where only the version
 * changed (JSON compared with the version fields blanked; in version.ts and the NSIS script every
 * changed line must be a version line on both sides). `read(rev, path)` gives a file at the merge
 * base ('base') or the head ('head'), null when it is not there.
 * @param {{ path: string, changeType?: string }[]} files
 * @param {(rev: 'base' | 'head', file: string) => string | null} read
 * @returns {{ release: boolean, why: string }} `why` says what stops it being one
 */
export function releasePr(files, read) {
  const no = (/** @type {string} */ why) => ({ release: false, why });
  const norm = files.map(f => ({ ...f, path: f.path.replace(/\\/g, '/') }));
  if (!norm.some(f => f.path === 'CHANGELOG.md')) return no('CHANGELOG.md is not changed');
  if (!norm.some(f => f.path === 'package.json')) return no('the root package.json is not changed');
  for (const f of norm) {
    const type = String(f.changeType ?? '').toUpperCase();
    if (f.path === 'CHANGELOG.md') {
      if (type === 'DELETED') return no('CHANGELOG.md is deleted');
      continue;
    }
    if (/^changelog\.d\/[^/]+\.md$/.test(f.path) && !/README\.md$/i.test(f.path)) {
      if (type !== 'DELETED') return no(`${f.path} is not deleted`);
      continue;
    }
    const isJson = VERSION_JSON.includes(f.path) || f.path === 'package-lock.json';
    const patterns = Object.hasOwn(VERSION_TEXT, f.path)
      ? VERSION_TEXT[/** @type {keyof typeof VERSION_TEXT} */ (f.path)]
      : undefined;
    if (!isJson && !patterns) return no(`${f.path} is not a changelog or version file`);
    const base = read('base', f.path);
    const head = read('head', f.path);
    if (base === null || head === null) return no(`${f.path} is added or deleted`);
    if (isJson) {
      const a = withoutVersions(f.path, jsonOf(base));
      const b = withoutVersions(f.path, jsonOf(head));
      if (!a || !b) return no(`${f.path} is not a JSON object`);
      if (!sameJson(a.data, b.data)) return no(`${f.path} changes more than its version`);
      // Every version field the base has must stay at the head (a dropped one is not a bump).
      if (b.versions.size !== a.versions.size) {
        return no(`${f.path} drops or adds a version field`);
      }
      for (const [key, v] of a.versions) {
        if (!b.versions.has(key) || (v === undefined) !== (b.versions.get(key) === undefined)) {
          return no(`${f.path} drops or adds a version field`);
        }
      }
      if (![...b.versions.values()].every(v => v === undefined || isVersion(v))) {
        return no(`${f.path} has a version that is not x.y.z`);
      }
      continue;
    }
    const la = lf(base).split('\n');
    const lb = lf(head).split('\n');
    if (la.length !== lb.length) return no(`${f.path} changes more than its version line`);
    /** The line with its version blanked, or null when it is not a version line. */
    const blanked = (/** @type {string} */ l) => {
      for (const p of /** @type {RegExp[]} */ (patterns)) {
        const m = p.exec(l);
        const span = m?.indices?.[1];
        if (span) return `${l.slice(0, span[0])}X${l.slice(span[1])}`;
      }
      return null;
    };
    for (let i = 0; i < la.length; i++) {
      if (la[i] === lb[i]) continue;
      const x = blanked(la[i]);
      if (x === null || x !== blanked(lb[i])) {
        return no(`${f.path} changes more than its version line (line ${i + 1})`);
      }
    }
  }
  const rootBase = jsonOf(read('base', 'package.json'))?.version;
  const rootHead = jsonOf(read('head', 'package.json'))?.version;
  if (!isVersion(rootHead) || rootBase === rootHead) {
    return no('the root package.json version does not change');
  }
  return { release: true, why: '' };
}

/**
 * Parses `git diff -z --name-status --no-renames` output: NUL-separated status and path pairs, so a
 * path with non-ASCII characters comes through as it is, not quoted. A rename or copy entry (should
 * --no-renames ever be dropped) carries two paths and yields both.
 * @param {string} text
 * @returns {{ path: string, changeType: string }[]}
 */
export function parseNameStatus(text) {
  /** @type {{ path: string, changeType: string }[]} */
  const files = [];
  const tokens = text.split(String.fromCharCode(0));
  for (let i = 0; i + 1 < tokens.length; ) {
    const status = tokens[i].trim();
    if (!/^[A-Z][0-9]*$/.test(status)) {
      i += 1;
      continue;
    }
    const changeType = { A: 'ADDED', M: 'MODIFIED', D: 'DELETED' }[status[0]] ?? 'CHANGED';
    const count = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    for (const p of tokens.slice(i + 1, i + 1 + count)) if (p) files.push({ path: p, changeType });
    i += 1 + count;
  }
  return files;
}
