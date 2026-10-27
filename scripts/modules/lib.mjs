/**
 * Module rehearsal library (I-117, D-128): pure helpers for scripts/modules/rehearse.mjs.
 * Versions, the installed scan, the archive layout and the pinned list, the plan of what is newer,
 * and the report text. No network and no process spawning here, so the tests need neither.
 *
 * The archive is a PC folder (default C:\FoundryAI\module-archive, MODULE_ARCHIVE overrides) that is
 * never inside a repo or the vault, because licensed and Patreon packages go in it:
 *
 *   pinned.json                          what the Pi may install (the tested versions)
 *   modules/<id>/<version>/<id>-<version>.zip + module.json
 *   systems/<id>/<version>/...           same shape for dnd5e
 *   foundry/FoundryVTT-Node-<version>.zip
 *   staging/<id>/<version>/              downloaded, not yet tested
 *   rehearsals/<stamp>-<server>/report.md + report.json
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_ARCHIVE = 'C:\\FoundryAI\\module-archive';
/** Where the Pi mirror of the archive lives (a path on the Pi; the Pi plan, not run here). */
export const PI_MIRROR_PATH = '/home/dietpi/module-archive';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,60}$/;

export const archiveRoot = (env = process.env) => env.MODULE_ARCHIVE || DEFAULT_ARCHIVE;

/** True for an id or version that is safe as a folder name. @param {unknown} s */
export const isSafeId = s => typeof s === 'string' && ID_RE.test(s) && !s.includes('..');
export const isSafeVersion = s => typeof s === 'string' && VERSION_RE.test(s) && !s.includes('..');

/**
 * Parses `v1.4.6`, `14.606.4.4`, `2.10.5-aitool.4` into numbers and a suffix. Anything after the
 * first non-numeric part counts as a pre-release style suffix (a release without one is newer).
 * @param {string} v
 */
export function parseVersion(v) {
  const m = /^v?(\d+(?:\.\d+)*)(.*)$/.exec(String(v ?? '').trim());
  if (!m) return { nums: [], suffix: String(v ?? '') };
  return { nums: m[1].split('.').map(Number), suffix: m[2].replace(/^[-+.]/, '') };
}

/**
 * Negative when a is older than b, 0 when equal, positive when newer. The Actor Studio fork
 * `2.10.5-aitool.4` sorts after `2.10.5` (a local suffix is a later build of that number), and
 * unparsable versions compare equal to each other and older than any parsable one.
 * @param {string} a @param {string} b
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa.nums.length || !pb.nums.length) return pa.nums.length - pb.nums.length;
  const n = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < n; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d) return d;
  }
  if (pa.suffix === pb.suffix) return 0;
  if (!pa.suffix) return -1;
  if (!pb.suffix) return 1;
  return pa.suffix.localeCompare(pb.suffix, 'en', { numeric: true });
}

/**
 * Installed modules and systems under a Foundry data folder (`<root>/data/Data`).
 * @param {string} dataDir
 * @returns {Array<{kind: 'module'|'system', id: string, title: string, version: string, manifest: string, verified: string, dir: string}>}
 */
export function scanInstalled(dataDir) {
  const out = [];
  for (const [kind, folder, file] of [
    ['module', 'modules', 'module.json'],
    ['system', 'systems', 'system.json'],
  ]) {
    const base = path.join(dataDir, folder);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      let json;
      try {
        json = JSON.parse(readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''));
      } catch {
        continue;
      }
      out.push({
        kind: /** @type {'module'|'system'} */ (kind),
        id: String(json.id ?? json.name ?? entry.name),
        title: String(json.title ?? entry.name),
        version: String(json.version ?? ''),
        manifest: String(json.manifest ?? ''),
        verified: String(json.compatibility?.verified ?? ''),
        dir,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
}

/** @typedef {{version: string, file?: string, sha256?: string, licensed?: boolean, testedOn?: string, rehearsal?: string, note?: string}} Pin */
/** @typedef {{updated: string, foundry: Pin | null, systems: Record<string, Pin>, modules: Record<string, Pin>}} Pinned */

/** @returns {Pinned} */
export const emptyPinned = () => ({ updated: '', foundry: null, systems: {}, modules: {} });

/** Reads pinned.json; a missing file is an empty list, a broken one throws. @param {string} root */
export function readPinned(root) {
  const file = path.join(root, 'pinned.json');
  if (!existsSync(file)) return emptyPinned();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return { ...emptyPinned(), ...parsed };
}

/** Folder of one archived version. @param {string} root @param {'module'|'system'} kind */
export function archiveDir(root, kind, id, version) {
  if (!isSafeId(id) || !isSafeVersion(version)) throw new Error(`unsafe archive name ${id} ${version}`);
  return path.join(root, kind === 'system' ? 'systems' : 'modules', id, version);
}

/** @param {string} file @returns {Promise<string>} */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * The newest version a manifest offers and where its zip is. Foundry manifests hold `version` and
 * `download`; a manifest that lacks either gives null for it.
 * @param {any} m
 */
export function readManifest(m) {
  if (!m || typeof m !== 'object') return null;
  const verified = String(m.compatibility?.verified ?? '');
  const minimum = String(m.compatibility?.minimum ?? '');
  return {
    id: String(m.id ?? m.name ?? ''),
    version: m.version ? String(m.version) : null,
    download: typeof m.download === 'string' && /^https:\/\//.test(m.download) ? m.download : null,
    verified,
    minimum,
  };
}

/**
 * What to do about each installed package: compares it with the pinned list and, when an upstream
 * lookup is given, with the newest version upstream.
 * @param {ReturnType<typeof scanInstalled>} installed
 * @param {Pinned} pinned
 * @param {Record<string, {version: string | null, download?: string | null, verified?: string, error?: string} | undefined>} [upstream] by id
 * @param {{modules: Array<{id: string, licensed?: boolean}>} | null} [strahd]
 */
export function planUpdates(installed, pinned, upstream = {}, strahd = null) {
  const inList = new Map((strahd?.modules ?? []).map(m => [m.id, m]));
  return installed.map(p => {
    const pin = (p.kind === 'system' ? pinned.systems : pinned.modules)[p.id];
    const up = upstream[p.id];
    const listed = inList.get(p.id);
    /** @type {string} */
    let state;
    if (up?.error) state = 'unreachable';
    else if (up?.version && compareVersions(up.version, p.version) > 0) state = 'newer-upstream';
    else if (!pin) state = 'not-archived';
    else if (compareVersions(p.version, pin.version) > 0) state = 'untested-installed';
    else if (compareVersions(p.version, pin.version) < 0) state = 'behind-archive';
    else state = 'pinned';
    return {
      kind: p.kind,
      id: p.id,
      installed: p.version,
      pinned: pin?.version ?? null,
      upstream: up?.version ?? null,
      download: up?.download ?? null,
      state,
      inStrahd: !!listed,
      licensed: !!listed?.licensed || !!pin?.licensed,
      error: up?.error ?? null,
    };
  });
}

/** A run's overall verdict: every step pass or an expected finding only. @param {Array<{status: string}>} steps */
export const runPassed = steps => steps.length > 0 && steps.every(s => s.status === 'pass' || s.status === 'skip');

/**
 * Findings that match an expected entry (`{module, match, why}`) are known upstream behaviour;
 * the rest are new. A match is a substring of the finding text; `max` caps how many may be known.
 * @param {Array<{module: string, text: string}>} findings
 * @param {Array<{id: string, module: string, match: string, why: string, max?: number}>} expected
 */
export function splitFindings(findings, expected) {
  const used = new Map();
  const known = [];
  const fresh = [];
  for (const f of findings) {
    const e = expected.find(
      x =>
        (x.module === f.module || x.module === '*') &&
        f.text.includes(x.match) &&
        (x.max === undefined || (used.get(x.id) ?? 0) < x.max)
    );
    if (e) {
      used.set(e.id, (used.get(e.id) ?? 0) + 1);
      known.push({ ...f, expectedId: e.id, why: e.why });
    } else fresh.push(f);
  }
  const unseen = expected.filter(e => !used.has(e.id)).map(e => e.id);
  return { known, fresh, unseen };
}

/**
 * The run report as Markdown. Short on purpose: one table of packages, the steps, the findings.
 * @param {{server: string, stamp: string, gitSha: string, foundry: string, system: string, plan: ReturnType<typeof planUpdates>, steps: Array<{name: string, status: string, detail?: string}>, findings: ReturnType<typeof splitFindings>}} r
 */
export function renderReport(r) {
  const changed = r.plan.filter(p => p.state !== 'pinned');
  const lines = [
    `# Module rehearsal ${r.stamp} on server ${r.server}`,
    '',
    `Foundry ${r.foundry}, system ${r.system}, repo ${r.gitSha}. Verdict: **${runPassed(r.steps) && !r.findings.fresh.length ? 'PASS' : 'FAIL'}**`,
    '',
    '## Steps',
    '',
    ...r.steps.map(s => `- ${s.status.toUpperCase()} ${s.name}${s.detail ? `: ${s.detail}` : ''}`),
    '',
    `## Packages that differ from the pinned list (${changed.length} of ${r.plan.length})`,
    '',
    '| package | installed | pinned | upstream | state |',
    '| --- | --- | --- | --- | --- |',
    ...changed.map(
      p => `| ${p.id}${p.licensed ? ' (licensed)' : ''} | ${p.installed} | ${p.pinned ?? '-'} | ${p.upstream ?? '-'} | ${p.state} |`
    ),
    '',
    `## New findings (${r.findings.fresh.length})`,
    '',
    ...(r.findings.fresh.length ? r.findings.fresh.map(f => `- ${f.module}: ${f.text}`) : ['None.']),
    '',
    `## Known findings (${r.findings.known.length})`,
    '',
    ...(r.findings.known.length
      ? r.findings.known.map(f => `- ${f.module}: ${f.text} [${f.expectedId}]`)
      : ['None.']),
    '',
    `Expected entries not seen this run: ${r.findings.unseen.length ? r.findings.unseen.join(', ') : 'none'}.`,
    '',
  ];
  return lines.join('\n');
}
