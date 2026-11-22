/**
 * The update notice (item client-updates, layer 2). The plugin tells the dashboard its version in
 * the `x-foundry-client` header and asks `GET /api/client-versions` which version the table runs;
 * an older plugin shows one small status bar notice with the download link.
 *
 * The plugin bundle does not import the shared package, so the compare and the wording are copied
 * here. Source of truth: `shared/src/client-versions.ts` (compareClientVersions, clientNoticeText,
 * CLIENT_HEADER). Keep the two in step.
 */

/** Mirror of the shared CLIENT_HEADER. */
export const CLIENT_HEADER = 'x-foundry-client';

/** Mirror of the shared INSTALL_HEADER: a random id per install, never a name. */
export const INSTALL_HEADER = 'x-foundry-install';

const INSTALL_KEY = 'foundry-ai-tool-install-id';

/**
 * A random id for this PC (12 hex), made on first use and kept in the app's local storage, so the
 * table's "who uses what" page can tell two PCs apart (D-146). It holds no name and no path.
 * Null when storage is unavailable.
 */
export function localInstallId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage
): string | null {
  try {
    const have = storage?.getItem(INSTALL_KEY);
    if (have && /^[0-9a-f]{12}$/.test(have)) return have;
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    const made = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    storage?.setItem(INSTALL_KEY, made);
    return storage ? made : null;
  } catch {
    return null;
  }
}

/** How often the plugin asks again after the first check at load (6 hours). */
const CLIENT_CHECK_INTERVAL_MS = 6 * 3600 * 1000;

/** The header value for this plugin build: `obsidian/<manifest version>`. */
export function clientHeaderValue(version: string): string {
  return `obsidian/${version}`;
}

/** Numeric per dot segment; -1 when a is older, 1 when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(p => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map(p => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The slice of the status bar element the notice uses (an Obsidian HTMLElement satisfies it). */
interface BarEl {
  addClass(cls: string): void;
  hide(): void;
  show(): void;
  setText(text: string): void;
  setAttribute(name: string, value: string): void;
}

/** The slice of the plugin the notice needs, so this file stays free of the `obsidian` import. */
interface NoticeHost {
  manifest: { version: string; dir?: string };
  addStatusBarItem(): BarEl & EventTarget;
  registerInterval(id: number): number;
  registerDomEvent(el: EventTarget, type: 'click', cb: () => void): void;
  app: {
    vault?: { adapter: { read(path: string): Promise<string> } };
    workspace: { onLayoutReady(cb: () => void): void };
  };
}

/**
 * A second status bar item, shown only while the plugin is behind the table: checked once the
 * layout is ready and every 6 hours. Silent on any failure.
 */
export function installUpdateNotice(
  host: NoticeHost,
  client: { clientVersions(): Promise<{ current: unknown; obsidianLink: unknown } | null> }
): void {
  const el = host.addStatusBarItem();
  el.addClass('foundry-ai-tool-update');
  el.hide();
  let link: string | null = null;
  host.registerDomEvent(el, 'click', () => {
    if (link) window.open(link);
  });
  const check = async (): Promise<void> => {
    const answer = await client.clientVersions();
    const notice = answer
      ? updateNotice(host.manifest.version, answer.current, answer.obsidianLink)
      : null;
    link = notice?.link ?? null;
    if (!notice) {
      el.hide();
      return;
    }
    el.setText(notice.text);
    el.setAttribute('aria-label', notice.title);
    el.setAttribute('title', notice.title);
    el.show();
  };
  host.registerInterval(window.setInterval(() => void check(), CLIENT_CHECK_INTERVAL_MS));
  host.app.workspace.onLayoutReady(() => void check());
  installRestartNotice(host);
}

interface UpdateNotice {
  /** The short status bar text. */
  text: string;
  /** Danish line, then English line (hover text). */
  title: string;
  /** Where a click goes; null when the table gave no link. */
  link: string | null;
}

/**
 * The notice for a plugin at `own` when the table runs `current`, or null when the plugin is up to
 * date or the answer is not usable. Only an http(s) link is kept.
 */
export function updateNotice(
  own: string,
  current: unknown,
  obsidianLink: unknown
): UpdateNotice | null {
  if (typeof current !== 'string' || !/^\d+(\.\d+){0,3}$/.test(current)) return null;
  if (!/^\d+(\.\d+){0,3}/.test(own) || compareVersions(own, current) >= 0) return null;
  const link =
    typeof obsidianLink === 'string' && /^https?:\/\//i.test(obsidianLink) ? obsidianLink : null;
  const da = `Opdatering klar: dit Obsidian-plugin er ${own}, bordet kører ${current}. Hent det her: ${link ?? ''}`;
  const en = `Update available: your Obsidian plugin is ${own}, the table runs ${current}. Download: ${link ?? ''}`;
  return {
    text: `Foundry AI Tool: opdatering ${current}`,
    title: `${da.trim()}\n${en.trim()}`,
    link,
  };
}

/** The status bar text and hover text (Danish line, then English line) once the plugin on disk is newer than the running one. */
export function restartNotice(
  running: string,
  onDisk: unknown
): { text: string; title: string } | null {
  if (typeof onDisk !== 'string' || !/^\d+(\.\d+){0,3}$/.test(onDisk)) return null;
  if (!/^\d+(\.\d+){0,3}/.test(running) || compareVersions(running, onDisk) >= 0) return null;
  return {
    text: 'Restart Obsidian',
    title: `Genstart Obsidian: pluginet på disken er ${onDisk}, det kørende er ${running}.\nRestart Obsidian: the plugin on disk is ${onDisk}, the running one is ${running}.`,
  };
}

/** The slice of the plugin the restart notice needs (the manifest folder and a file reader). */
interface RestartHost {
  manifest: { version: string; dir?: string };
  addStatusBarItem(): BarEl;
  registerInterval(id: number): number;
  app: {
    vault?: { adapter: { read(path: string): Promise<string> } };
    workspace: { onLayoutReady(cb: () => void): void };
  };
}

/**
 * Syncthing may replace the plugin files while Obsidian runs (stage 33). A status bar item says
 * "Restart Obsidian" while manifest.json on disk is newer than the running version: checked once the
 * layout is ready and every 10 minutes. Silent on any failure.
 */
export function installRestartNotice(host: RestartHost): void {
  const dir = host.manifest.dir;
  const vault = host.app.vault;
  if (!dir || !vault) return;
  const el = host.addStatusBarItem();
  el.addClass('foundry-ai-tool-restart');
  el.hide();
  const check = async (): Promise<void> => {
    try {
      const raw = await vault.adapter.read(`${dir}/manifest.json`);
      const disk = (JSON.parse(raw) as { version?: unknown }).version;
      const notice = restartNotice(host.manifest.version, disk);
      if (!notice) {
        el.hide();
        return;
      }
      el.setText(notice.text);
      el.setAttribute('aria-label', notice.title);
      el.setAttribute('title', notice.title);
      el.show();
    } catch {
      /* no manifest to read: say nothing */
    }
  };
  host.registerInterval(window.setInterval(() => void check(), 10 * 60 * 1000));
  host.app.workspace.onLayoutReady(() => void check());
}
