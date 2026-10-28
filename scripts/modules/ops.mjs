/**
 * Module rehearsal operations with side effects (I-117): reading a test server's folders, fetching
 * public manifests and zips, unpacking, zipping an installed folder and writing the archive.
 * Everything that mutates is limited to the archive folder and the named test server's data
 * folder; the live ports and the Pi are never touched from here.
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
  createWriteStream,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  archiveDir,
  isSafeId,
  readManifest,
  readPinned,
  sha256File,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');
const LIVE_PORTS = [31414, 31415, 31416];

/** The test server entry from scripts/test-env/servers.json. @param {string} name */
export function serverInfo(name) {
  const all = JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts', 'test-env', 'servers.json'), 'utf8'));
  const s = all[String(name).toUpperCase()];
  if (!s) throw new Error(`unknown test server "${name}" (A, B or C)`);
  for (const p of [s.ControlPort, s.LinkPort]) {
    if (LIVE_PORTS.includes(p)) throw new Error('refusing: a live bridge port');
  }
  return { ...s, name: String(name).toUpperCase(), dataDir: path.join(s.Root, 'data', 'Data'), AppDir: appDirOf(String(name).toUpperCase(), all) };
}

/** The Foundry app folder of a server: its local file's AppDir, else (B, C) server A's, else <Root>/app. */
function appDirOf(name, all) {
  const local = n => {
    const file = path.join(REPO_ROOT, 'scripts', 'test-env', n === 'A' ? 'local.json' : `local.${n}.json`);
    try {
      return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')).AppDir ?? null;
    } catch {
      return null;
    }
  };
  return local(name) ?? (name === 'A' ? null : local('A')) ?? path.join(all.A.Root, 'app');
}

/** True when something listens on 127.0.0.1:port. @param {number} port */
export function portOpen(port) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    sock.once('connect', () => (sock.destroy(), resolve(true)));
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => (sock.destroy(), resolve(false)));
  });
}

/**
 * Who holds a test server's lock (scripts/test-env/lock.ps1 writes <Root>/lock.json). Null when it is
 * free or has no file; an unreadable file counts as held, so a broken lock never reads as free.
 * @param {{Root: string}} srv
 */
export function lockHolder(srv) {
  const file = path.join(srv.Root, 'lock.json');
  if (!existsSync(file)) return null;
  try {
    const l = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return l?.holder ? { holder: String(l.holder), session: l.session ? String(l.session) : '' } : null;
  } catch {
    return { holder: 'unreadable lock.json', session: '' };
  }
}

/** GET a JSON manifest from https; null-safe result with an error text. @param {string} url */
export async function fetchManifest(url) {
  if (!/^https:\/\//.test(url)) return { error: 'no https manifest url' };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const m = readManifest(await r.json());
    return m?.version ? m : { error: 'manifest has no version' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Download a file and refuse anything that is not a zip: https after redirects too, written to a
 * .part file and moved into place only once it starts like a zip.
 * @param {string} url @param {string} dest @param {typeof fetch} [fetchImpl]
 */
export async function downloadZip(url, dest, fetchImpl = fetch) {
  if (!/^https:\/\//.test(url)) throw new Error('refusing a non-https download');
  mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60 * 1000), redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`download failed: HTTP ${r.status}`);
  if (new URL(r.url || url).protocol !== 'https:') throw new Error('refusing a download that redirected away from https');
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(/** @type {any} */ (r.body)), createWriteStream(part));
    const fd = openSync(part, 'r');
    const buf = Buffer.alloc(4);
    try {
      readSync(fd, buf, 0, 4, 0);
    } finally {
      closeSync(fd);
    }
    if (buf.toString('latin1') !== 'PK\x03\x04') throw new Error('the download is not a zip file');
    renameSync(part, dest);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  return sha256File(dest);
}

/** Windows bsdtar reads and writes zips. Throws with its message. @param {string[]} args */
function tar(args) {
  // Git Bash puts GNU tar first on PATH, which reads "C:" as a host; Windows ships bsdtar.
  const exe = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tar ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
}

/**
 * Unpack a module or system zip into a fresh folder and return the folder that holds module.json
 * (or system.json), whether the zip has it at its root or inside one folder.
 * @param {string} zip @param {string} [file]
 */
export function unpackZip(zip, file = 'module.json') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rehearse-'));
  tar(['-xf', zip, '-C', tmp]);
  if (existsSync(path.join(tmp, file))) return { tmp, root: tmp };
  const inner = readdirSync(tmp, { withFileTypes: true }).filter(e => e.isDirectory());
  for (const d of inner) {
    if (existsSync(path.join(tmp, d.name, file))) return { tmp, root: path.join(tmp, d.name) };
  }
  rmSync(tmp, { recursive: true, force: true });
  throw new Error(`${path.basename(zip)} has no ${file}`);
}

/** Zip an installed folder (for packages that have no downloadable zip). @param {string} dir @param {string} zip */
export function zipFolder(dir, zip) {
  mkdirSync(path.dirname(zip), { recursive: true });
  tar(['-a', '-cf', zip, '-C', dir, '.']);
}

/**
 * Put a package into the archive: the zip (given, or made from the installed folder), the manifest,
 * and a pinned.json entry.
 * @param {{root: string, kind: 'module'|'system', id: string, version: string, zip?: string, installedDir?: string, licensed?: boolean, rehearsal?: string, testedOn?: string, note?: string}} o
 */
export async function archivePackage(o) {
  const dir = archiveDir(o.root, o.kind, o.id, o.version);
  mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, `${o.id}-${o.version}.zip`);
  if (o.zip) cpSync(o.zip, zipPath);
  else if (o.installedDir) zipFolder(o.installedDir, zipPath);
  else throw new Error('archivePackage needs a zip or an installed folder');
  const { tmp, root } = unpackZip(zipPath, o.kind === 'system' ? 'system.json' : 'module.json');
  try {
    cpSync(path.join(root, o.kind === 'system' ? 'system.json' : 'module.json'), path.join(dir, 'module.json'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const sha256 = await sha256File(zipPath);
  const pinned = readPinned(o.root);
  const bucket = o.kind === 'system' ? pinned.systems : pinned.modules;
  bucket[o.id] = {
    version: o.version,
    file: path.relative(o.root, zipPath).replaceAll('\\', '/'),
    sha256,
    ...(o.licensed ? { licensed: true } : {}),
    ...(o.testedOn ? { testedOn: o.testedOn } : {}),
    ...(o.rehearsal ? { rehearsal: o.rehearsal } : {}),
    ...(o.note ? { note: o.note } : {}),
  };
  pinned.updated = new Date().toISOString();
  writePinned(o.root, pinned);
  return zipPath;
}

/** Write pinned.json through a temp file. @param {string} root @param {object} pinned */
export function writePinned(root, pinned) {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, 'pinned.json');
  writeFileSync(file + '.tmp', JSON.stringify(pinned, null, 2) + '\n');
  renameSync(file + '.tmp', file);
}

/**
 * Replace one installed package with an unpacked one; the old folder moves to the rollback folder.
 * The test server must be stopped (Foundry holds its files open and caches manifests).
 * @param {{dataDir: string, kind: 'module'|'system', id: string, zip: string, rollbackDir: string}} o
 */
export function installFromZip(o) {
  if (!isSafeId(o.id)) throw new Error(`unsafe id ${o.id}`);
  const folder = path.join(o.dataDir, o.kind === 'system' ? 'systems' : 'modules', o.id);
  const { tmp, root } = unpackZip(o.zip, o.kind === 'system' ? 'system.json' : 'module.json');
  try {
    const inner = readManifest(JSON.parse(readFileSync(path.join(root, o.kind === 'system' ? 'system.json' : 'module.json'), 'utf8')));
    if (inner?.id !== o.id) throw new Error(`${path.basename(o.zip)} holds "${inner?.id}", not "${o.id}"; nothing installed`);
    mkdirSync(o.rollbackDir, { recursive: true });
    if (existsSync(folder)) renameSync(folder, path.join(o.rollbackDir, `${o.kind}-${o.id}`));
    cpSync(root, folder, { recursive: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return folder;
}
