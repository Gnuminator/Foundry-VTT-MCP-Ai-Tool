/**
 * The journal pages a scene points at, for the read-aloud shelf (I-167). A scene can link one
 * journal entry or page directly, and its map notes (pins) link more. The raw page HTML goes to
 * the backend, which picks the boxed read-aloud text out of it; nothing is stored here.
 */
import { viewedScene } from '../viewed-scene.js';
import * as shared from './shared.js';

/** Most pages one answer carries (a book scene with a pin per room stays bounded). */
const MAX_PAGES = 12;

interface ScenePage {
  journalId: string;
  journalName: string;
  pageId: string;
  pageName: string;
  /** "scene" for the scene's own link, "note" for a map pin. */
  from: 'scene' | 'note';
  html: string;
}

interface ScenePagesReply {
  sceneId: string;
  sceneName: string;
  /** How many text pages the scene links in all; `pages` holds at most MAX_PAGES of them. */
  totalPages: number;
  pages: ScenePage[];
}

interface PageLike {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  sort?: number | null;
  text?: { content?: string | null } | null;
}
interface JournalLike {
  id?: string | null;
  name?: string | null;
  pages?: Iterable<PageLike> & { get?: (id: string) => PageLike | undefined };
}
interface SceneLike {
  id: string;
  name: string;
  journal?: JournalLike | string | null;
  journalEntryPage?: string | null;
  notes?: Iterable<{
    entryId?: string | null;
    pageId?: string | null;
    entry?: JournalLike | null;
    page?: PageLike | null;
  }>;
}

function pagesOf(journal: JournalLike): PageLike[] {
  return journal.pages
    ? Array.from(journal.pages).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    : [];
}

/**
 * The text pages a scene links. With `sceneId` that scene, else the one on screen. Pages named
 * by a link (the scene's own, then each map pin's) come first, in that order; the pages of a
 * whole linked entry follow, by their sort order. The answer carries at most MAX_PAGES pages;
 * `totalPages` says how many were found, so a cut is visible.
 */
export function getScenePages(sceneId?: string): ScenePagesReply {
  shared.validateFoundryState();
  const scenes = game.scenes as unknown as { get(id: string): SceneLike | undefined };
  const scene = (sceneId ? scenes.get(sceneId) : viewedScene(game.scenes)) as
    | SceneLike
    | null
    | undefined;
  if (!scene) throw new Error('Scene not found');

  const named: ScenePage[] = [];
  const whole: ScenePage[] = [];
  const seen = new Set<string>();
  const add = (
    into: ScenePage[],
    journal: JournalLike | null | undefined,
    page: PageLike,
    from: ScenePage['from']
  ): void => {
    if (!journal || page.type !== 'text') return;
    const key = `${journal.id ?? ''}.${page.id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    into.push({
      journalId: journal.id ?? '',
      journalName: journal.name ?? '',
      pageId: page.id ?? '',
      pageName: page.name ?? '',
      from,
      html: page.text?.content ?? '',
    });
  };

  const entry = typeof scene.journal === 'object' ? scene.journal : null;
  if (entry) {
    const linked = scene.journalEntryPage ? entry.pages?.get?.(scene.journalEntryPage) : undefined;
    if (linked) add(named, entry, linked, 'scene');
    else for (const page of pagesOf(entry)) add(whole, entry, page, 'scene');
  }
  for (const note of Array.from(scene.notes ?? [])) {
    const journal = note.entry ?? null;
    if (!journal) continue;
    // A pin that names a page whose page is gone (deleted) gives nothing, not the whole entry.
    if (note.pageId) {
      if (note.page) add(named, journal, note.page, 'note');
    } else for (const page of pagesOf(journal)) add(whole, journal, page, 'note');
  }
  const all = [...named, ...whole];
  return {
    sceneId: scene.id,
    sceneName: scene.name,
    totalPages: all.length,
    pages: all.slice(0, MAX_PAGES),
  };
}
