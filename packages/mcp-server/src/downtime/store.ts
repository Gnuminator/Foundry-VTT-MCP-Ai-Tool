/**
 * Downtime inbox (I-180): what a player does between sessions, written on their own page.
 *
 * One file per world in the bridge vault (`gm/downtime.json`), never in Foundry world data, so
 * nothing reaches another player's client. Every entry is marked `source: 'player'`: the prep
 * digest quotes it as the player's wish, never as something that happened in the campaign.
 */
import { randomBytes } from 'crypto';

import type { VaultStore } from '../vault/store.js';

const DOWNTIME_FILE = 'downtime.json';
const DOWNTIME_MAX_TEXT = 1000;
export const DOWNTIME_MAX_PER_PLAYER = 10;

interface DowntimeEntry {
  id: string;
  userId: string;
  name: string;
  text: string;
  source: 'player';
  createdAt: string;
  updatedAt: string;
}

type DowntimeStoreLike = Pick<VaultStore, 'read' | 'update'>;

const ID_RE = /^[a-f0-9]{16}$/;

function clean(value: unknown): DowntimeEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is DowntimeEntry =>
      e !== null &&
      typeof e === 'object' &&
      typeof (e as DowntimeEntry).id === 'string' &&
      typeof (e as DowntimeEntry).userId === 'string' &&
      typeof (e as DowntimeEntry).text === 'string'
  );
}

export async function listDowntime(
  store: Pick<VaultStore, 'read'>,
  worldId: string
): Promise<DowntimeEntry[]> {
  const file = await store.read<DowntimeEntry[]>(worldId, 'gm', DOWNTIME_FILE);
  return clean(file?.data);
}

/**
 * The control method `downtime`: `{action: 'list'|'save'|'delete', userId, name?, id?, text?}`.
 * A player can only ever touch entries carrying their own user id.
 */
export async function handleDowntime(
  store: DowntimeStoreLike,
  worldId: string,
  params: unknown,
  now: () => Date = () => new Date()
): Promise<{ entries: DowntimeEntry[] }> {
  const p =
    params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const action = p.action;
  const userId = typeof p.userId === 'string' ? p.userId : '';
  if (!userId) throw new Error('downtime needs a userId');
  const mine = (all: DowntimeEntry[]): DowntimeEntry[] => all.filter(e => e.userId === userId);
  if (action === 'list') {
    return { entries: mine(await listDowntime(store, worldId)) };
  }
  if (action === 'save') {
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (!text) throw new Error('Write something first.');
    if (text.length > DOWNTIME_MAX_TEXT) {
      throw new Error(`Keep it under ${DOWNTIME_MAX_TEXT} characters.`);
    }
    const name = typeof p.name === 'string' ? p.name.slice(0, 80) : '';
    if (p.id !== undefined && !(typeof p.id === 'string' && ID_RE.test(p.id))) {
      throw new Error('That entry is gone.');
    }
    const id = typeof p.id === 'string' ? p.id : null;
    const stamp = now().toISOString();
    const envelope = await store.update<DowntimeEntry[]>(
      worldId,
      'gm',
      DOWNTIME_FILE,
      1,
      current => {
        const all = clean(current?.data);
        if (id) {
          const at = all.findIndex(e => e.id === id && e.userId === userId);
          const old = all[at];
          if (!old) throw new Error('That entry is gone.');
          all[at] = { ...old, text, name: name || old.name, updatedAt: stamp };
          return all;
        }
        if (mine(all).length >= DOWNTIME_MAX_PER_PLAYER) {
          throw new Error(`You can keep ${DOWNTIME_MAX_PER_PLAYER} entries. Delete one first.`);
        }
        all.push({
          id: randomBytes(8).toString('hex'),
          userId,
          name,
          text,
          source: 'player',
          createdAt: stamp,
          updatedAt: stamp,
        });
        return all;
      }
    );
    return { entries: mine(clean(envelope.data)) };
  }
  if (action === 'delete') {
    const id = typeof p.id === 'string' ? p.id : '';
    const envelope = await store.update<DowntimeEntry[]>(worldId, 'gm', DOWNTIME_FILE, 1, current =>
      clean(current?.data).filter(e => !(e.id === id && e.userId === userId))
    );
    return { entries: mine(clean(envelope.data)) };
  }
  throw new Error('downtime: unknown action');
}
