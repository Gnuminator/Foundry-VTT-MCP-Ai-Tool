/**
 * Graph view colours for the mirror's adventures (I-105), without `obsidian` so it runs in node
 * tests. Each adventure hub note (`type: adventure-hub`) lists the folders its notes live in; this
 * builds one graph colour group per hub plus one grey group per campaign root for the Library, and
 * merges them into the vault's `graph.json` next to the GM's own groups. Groups of ours are found
 * again by their query shape, replaced on every run, and keep a colour the GM changed.
 */

/** A graph colour group as Obsidian stores it in graph.json. */
export interface ColourGroup {
  query: string;
  color: { a: number; rgb: number };
}

/** One adventure hub note: its vault-relative path and its campaign-relative folders. */
export interface HubInfo {
  path: string;
  folders: string[];
}

const HUB_PATH = /^(?:(.*)\/)?AI Tool\/Foundry\/Adventures\/[^/]+\.md$/;
const LIBRARY_PATH = /^(?:(.*)\/)?AI Tool\/Library\/.+$/;
const OUR_HUB_QUERY = /^path:"[^"]*AI Tool\/Foundry\/Adventures\/[^"]+\.md"/;
const OUR_LIBRARY_QUERY = /^path:"[^"]*AI Tool\/Library\/"$/;
const FIRST_TERM = /^path:"([^"]*)"/;

/** Ten clearly distinct colours for the adventures, used by index (wrapping around). */
export const ADVENTURE_PALETTE: readonly number[] = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231, 0x911eb4, 0x42d4f4, 0xf032e6, 0x9a6324,
  0x469990,
];

export const LIBRARY_GREY = 0x8a8a8a;

/** The campaign root of a hub path: '' at the vault root, null when it is not a hub path. */
export function campaignRootOf(hubPath: string): string | null {
  const match = HUB_PATH.exec(hubPath);
  if (!match) return null;
  return match[1] ?? '';
}

/** The campaign root of a note under `AI Tool/Library/`, or null for any other path. */
export function libraryRootOf(path: string): string | null {
  const match = LIBRARY_PATH.exec(path);
  if (!match) return null;
  return match[1] ?? '';
}

function join(root: string, rest: string): string {
  return root ? `${root}/${rest}` : rest;
}

function colour(rgb: number): { a: number; rgb: number } {
  return { a: 1, rgb };
}

function folderTerm(root: string, folder: string): string {
  return `path:"${join(root, folder.replace(/\/+$/, ''))}/"`;
}

function libraryQuery(root: string): string {
  return `path:"${join(root, 'AI Tool/Library/')}"`;
}

/**
 * The groups the mirror owns: one per hub (sorted by hub path, a palette colour by index), then
 * one grey Library group per campaign root (roots from the hubs plus `libraryRoots`).
 */
export function ourGroups(
  hubs: readonly HubInfo[],
  libraryRoots: readonly string[]
): ColourGroup[] {
  const sorted = [...hubs]
    .filter(hub => campaignRootOf(hub.path) !== null)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const roots = new Set<string>(libraryRoots);
  const groups: ColourGroup[] = [];
  sorted.forEach((hub, index) => {
    const root = campaignRootOf(hub.path) ?? '';
    roots.add(root);
    const terms = [`path:"${hub.path}"`, ...hub.folders.map(folder => folderTerm(root, folder))];
    groups.push({
      query: terms.join(' OR '),
      color: colour(ADVENTURE_PALETTE[index % ADVENTURE_PALETTE.length] ?? LIBRARY_GREY),
    });
  });
  for (const root of [...roots].sort()) {
    groups.push({ query: libraryQuery(root), color: colour(LIBRARY_GREY) });
  }
  return groups;
}

function queryOf(group: unknown): string | null {
  if (typeof group !== 'object' || group === null) return null;
  const query = (group as { query?: unknown }).query;
  return typeof query === 'string' ? query : null;
}

/** True for a group the mirror made (by the shape of its query). */
export function isOurGroup(group: unknown): boolean {
  const query = queryOf(group);
  return query !== null && (OUR_HUB_QUERY.test(query) || OUR_LIBRARY_QUERY.test(query));
}

function firstTerm(group: unknown): string | null {
  const match = FIRST_TERM.exec(queryOf(group) ?? '');
  return match?.[1] ?? null;
}

function isColour(value: unknown): value is { a: number; rgb: number } {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as { a?: unknown; rgb?: unknown };
  return typeof c.a === 'number' && typeof c.rgb === 'number';
}

/**
 * Puts our groups into a graph.json value: the GM's own groups first (original order, so their
 * colours win), then ours. An old group of ours with the same first term keeps its colour.
 * Everything else in the file is left as it is; an unreadable file counts as empty.
 */
export function mergeGraphColourGroups(
  graphJson: unknown,
  groups: readonly ColourGroup[]
): { json: Record<string, unknown>; added: number; kept: number } {
  const base =
    typeof graphJson === 'object' && graphJson !== null && !Array.isArray(graphJson)
      ? (graphJson as Record<string, unknown>)
      : {};
  const existing: unknown[] = Array.isArray(base.colorGroups) ? base.colorGroups : [];
  const mine = existing.filter(isOurGroup);
  const user = existing.filter(group => !isOurGroup(group));
  const oldColours = new Map<string, { a: number; rgb: number }>();
  for (const group of mine) {
    const key = firstTerm(group);
    const old = (group as { color?: unknown }).color;
    if (key !== null && isColour(old) && !oldColours.has(key)) oldColours.set(key, old);
  }
  const ours = groups.map(group => {
    const key = firstTerm(group);
    const old = key === null ? undefined : oldColours.get(key);
    return { query: group.query, color: old ? { a: old.a, rgb: old.rgb } : { ...group.color } };
  });
  return {
    json: { ...base, colorGroups: [...user, ...ours] },
    added: ours.length,
    kept: user.length,
  };
}

/** What `applyGraphColoursTo` needs from Obsidian (main.ts implements it; tests fake it). */
export interface GraphHost {
  /** Closes every open graph view; returns how many were open. */
  closeGraphViews(): Promise<number>;
  /** The loaded graph plugin's live options, or null when there is no instance. */
  graphOptions(): Record<string, unknown> | null;
  /** Puts the colour groups into the live options and saves them; false when that failed. */
  setGraphOptions(options: Record<string, unknown>): Promise<boolean>;
  /** The vault's graph.json, parsed ({} when missing or unreadable). */
  readGraphJson(): Promise<unknown>;
  writeGraphJson(json: unknown): Promise<void>;
  openGraphView(): Promise<void>;
}

export interface GraphColoursResult {
  /** Adventure hubs coloured. */
  adventures: number;
  /** The GM's own colour groups that stay. */
  kept: number;
  /** Graph views opened again (0 or 1). */
  reopened: number;
  /** The graph plugin's live options took the groups (no reopen needed to see them). */
  live: boolean;
}

/**
 * Colours the adventures in the graph view (I-105). Open graph views close first, so Obsidian
 * stores their current options (a group the GM just added included); the merge starts from the
 * graph plugin's live options when it is loaded, else from graph.json. The plugin saves graph.json
 * itself; without it the file is written here. One graph view opens again when any was open.
 */
export async function applyGraphColoursTo(
  host: GraphHost,
  hubs: HubInfo[],
  libraryRoots: string[]
): Promise<GraphColoursResult> {
  const closed = await host.closeGraphViews();
  const options = host.graphOptions();
  const base = options ?? (await host.readGraphJson());
  const { json, kept } = mergeGraphColourGroups(base, ourGroups(hubs, libraryRoots));
  const updated = options !== null && (await host.setGraphOptions(json));
  if (!updated) await host.writeGraphJson(json);
  let reopened = 0;
  if (closed > 0) {
    await host.openGraphView();
    reopened = 1;
  }
  return { adventures: hubs.length, kept, reopened, live: updated };
}

/** The notice after `applyGraphColoursTo`. */
export function graphColoursNotice(result: GraphColoursResult): string {
  const adventures = result.adventures === 1 ? '1 adventure' : `${result.adventures} adventures`;
  const own =
    result.kept === 0
      ? ''
      : result.kept === 1
        ? ' Your own colour group stays.'
        : ` Your ${result.kept} own colour groups stay.`;
  const reopen =
    result.reopened === 0 && !result.live ? ' Close and reopen the graph view to see them.' : '';
  return `Graph colours set for ${adventures}, the Library in grey.${own}${reopen}`;
}
