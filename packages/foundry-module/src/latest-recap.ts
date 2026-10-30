/**
 * "Latest recap" button for players (recap-button): a button in the journal sidebar that opens the
 * newest session recap the GM has revealed. Read-only: it only looks at journal pages this user can
 * already read and opens one; it calls no bridge method and writes nothing (D-087 stays as it is).
 *
 * A revealed recap is a page named "Recap" that the user may read: either a copy in the player
 * journal "Handouts" (flag `copiedFrom` names the source page) or the session notes page itself
 * once its journal is open to players. The order is the time the page was created, so the newest
 * reveal is the "latest" and older recaps stay in the same journal, one page per session.
 */
import { MODULE_ID } from './constants.js';

/** The session notes page title the bridge gives the recap (`PAGE_TITLES.recap`). */
export const RECAP_PAGE_NAME = 'Recap';

/** What the picker needs of a journal page; tests pass plain objects. */
export interface RecapCandidate {
  id: string;
  name: string;
  /** The user may read it (Observer or better). */
  readable: boolean;
  /** `flags.foundry-mcp-bridge.copiedFrom`: set on a reveal copy. */
  copiedFrom?: string | undefined;
  /** The page's journal carries the session notes flag (only visible when readable). */
  inNotesJournal: boolean;
  createdTime: number;
}

/** The newest readable recap, or null. */
export function pickLatestRecap<T extends RecapCandidate>(pages: readonly T[]): T | null {
  let best: T | null = null;
  for (const page of pages) {
    if (!page.readable) continue;
    if (page.name.trim().toLowerCase() !== RECAP_PAGE_NAME.toLowerCase()) continue;
    if (!page.copiedFrom && !page.inNotesJournal) continue;
    if (!best || page.createdTime >= best.createdTime) best = page;
  }
  return best;
}

interface FoundryPage {
  id: string;
  name: string;
  parent: {
    sheet?: { render(options: Record<string, unknown>): unknown };
    getFlag?(scope: string, key: string): unknown;
  } | null;
  _stats?: { createdTime?: number | null };
  testUserPermission(user: unknown, level: string): boolean;
  getFlag(scope: string, key: string): unknown;
}

function collect(): Array<RecapCandidate & { page: FoundryPage }> {
  const out: Array<RecapCandidate & { page: FoundryPage }> = [];
  for (const entry of game.journal as unknown as Iterable<{ pages: Iterable<FoundryPage> }>) {
    for (const page of entry.pages) {
      const copiedFrom = page.getFlag(MODULE_ID, 'copiedFrom');
      out.push({
        id: page.id,
        name: String(page.name ?? ''),
        readable: page.testUserPermission(game.user, 'OBSERVER'),
        copiedFrom: typeof copiedFrom === 'string' && copiedFrom ? copiedFrom : undefined,
        inNotesJournal: page.parent?.getFlag?.(MODULE_ID, 'sessionNotes') === true,
        createdTime: Number(page._stats?.createdTime ?? 0),
        page,
      });
    }
  }
  return out;
}

/** Open the newest revealed recap, or say there is none yet. */
export function openLatestRecap(): void {
  const found = pickLatestRecap(collect());
  if (!found) {
    ui.notifications?.info('No recap yet. The GM shares one after a session.');
    return;
  }
  found.page.parent?.sheet?.render({ force: true, pageId: found.page.id });
}

/** Add the button to the journal sidebar (every client; players and the GM). */
export function registerLatestRecapButton(): void {
  Hooks.on('renderJournalDirectory', (_app: unknown, html: HTMLElement | { 0?: HTMLElement }) => {
    try {
      const root = html instanceof HTMLElement ? html : html?.[0];
      if (!root || root.querySelector('.foundry-mcp-latest-recap')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'foundry-mcp-latest-recap';
      button.innerHTML = '<i class="fa-solid fa-scroll"></i> Latest recap';
      button.addEventListener('click', event => {
        event.preventDefault();
        openLatestRecap();
      });
      const anchor = root.querySelector('.header-actions, .directory-header .action-buttons');
      if (anchor) anchor.appendChild(button);
      else root.querySelector('.directory-header, header')?.appendChild(button);
    } catch (error) {
      console.error(`[${MODULE_ID}] Could not add the Latest recap button:`, error);
    }
  });
}
