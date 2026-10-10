// GET /api/player-links, and the module errors the live stream brings (Module diagnostics).
import { at } from './common';

export const PLAYER_LINKS = [
  { userId: 'aaaaaaaaaaaaaaaa', name: 'Mara', link: '/me?k=maraKey', createdAt: at(18) },
  { userId: 'bbbbbbbbbbbbbbbb', name: 'Tobias', link: null, createdAt: null },
  { userId: 'cccccccccccccccc', name: 'Nell', link: '/me?k=nellKey', createdAt: at(19) },
];

export const MANY_PLAYER_LINKS = [
  ...PLAYER_LINKS,
  {
    userId: 'dddddddddddddddd',
    name: 'Ottilie of the Western Harbor Guild',
    link: null,
    createdAt: null,
  },
  { userId: 'eeeeeeeeeeeeeeee', name: 'Pell', link: '/me?k=pellKey', createdAt: at(19, 30) },
  { userId: 'ffffffffffffffff', name: 'Quill', link: null, createdAt: null },
];

export const MODULE_ERRORS = [
  {
    id: 'e1',
    timestampMs: at(19, 1),
    level: 'error',
    message: 'Cannot read properties of undefined',
    stack: 'TypeError at module:fog-helper/main.js',
    module: 'module:fog-helper',
  },
  {
    id: 'w1',
    timestampMs: at(19, 2),
    level: 'warn',
    message: 'Deprecated since v13',
    stack: null,
    module: 'system:dnd5e',
  },
  {
    id: 'e2',
    timestampMs: at(19, 3),
    level: 'error',
    message: 'No stack to tell',
    stack: null,
    module: null,
  },
  {
    id: 'e3',
    timestampMs: at(19, 4),
    level: 'error',
    message:
      'A very long message from a module that did not expect a token without an actor, repeated for emphasis: the token has no actor, the actor has no token',
    stack: null,
    module: 'module:lantern-lighting-and-atmosphere-extended',
  },
];

/** The shape useModuleErrors reads from the cache. */
export const moduleErrorLog = (
  entries: typeof MODULE_ERRORS
): { entries: typeof MODULE_ERRORS; errors: number; warns: number } => ({
  entries,
  errors: entries.filter(e => e.level === 'error').length,
  warns: entries.filter(e => e.level === 'warn').length,
});
