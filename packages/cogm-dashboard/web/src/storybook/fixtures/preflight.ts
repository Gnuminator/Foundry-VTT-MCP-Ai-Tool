// GET /api/preflight and GET /api/session/switches.
const CHECKS = (versionMismatch: boolean): unknown[] => [
  {
    id: 'versions',
    label: 'Versions match',
    status: versionMismatch ? 'fail' : 'ok',
    detail: versionMismatch
      ? 'The Foundry module is 0.20.2 but the bridge is 0.21.0. Update the module.'
      : 'Bridge 0.21.0, module 0.21.0.',
  },
  { id: 'scene', label: 'Starting scene', status: 'ok', detail: 'Harbor Market is active.' },
  {
    id: 'hidden',
    label: 'Hidden tokens',
    status: 'warn',
    detail: 'One token on the active scene is hidden.',
  },
  { id: 'journals', label: 'Handout pages', status: 'ok', detail: 'All set to None.' },
  { id: 'notes', label: 'Last session note', status: 'info', detail: 'Found in the vault.' },
];

const SCAN = {
  settings: [{ setting: 'core.worldTitle', masked: 'shown', reason: 'names the harbor' }],
  names: [{ kind: 'Actor', name: 'Old Gull', terms: ['gull'] }],
  modules: [{ title: 'Fog Helper', reason: 'draws over the map for everyone' }],
};

export const PREFLIGHT_OK = { ready: true, checks: CHECKS(false), scan: SCAN };
export const PREFLIGHT_VERSION_MISMATCH = { ready: false, checks: CHECKS(true), scan: SCAN };
export const PREFLIGHT_CLEAN = {
  ready: true,
  checks: CHECKS(false).map(c => ({ ...(c as object), status: 'ok' })),
  scan: { settings: [], names: [], modules: [] },
};

const SWITCH_LIST = [
  { id: 'handouts', name: 'AI Tool: Handouts (writes)', on: true },
  { id: 'party', name: 'AI Tool: Party (writes)', on: true },
  { id: 'live', name: 'AI Tool: Live play (writes)', on: false },
];

export const SWITCHES_READY = {
  switches: { switches: SWITCH_LIST, ready: null, changed: [], failed: [] },
  gmActionsEnabled: true,
  error: null,
};

export const SWITCHES_OFF = {
  switches: {
    switches: SWITCH_LIST.map(s => ({ ...s, on: false })),
    ready: null,
    changed: [],
    failed: [],
  },
  gmActionsEnabled: false,
  error: null,
};

export const SWITCHES_TONIGHT = {
  switches: {
    switches: SWITCH_LIST.map(s => ({ ...s, on: true })),
    ready: { at: Date.UTC(2026, 9, 8, 18, 0), turnedOn: ['handouts', 'party', 'live'] },
    changed: [],
    failed: [],
  },
  gmActionsEnabled: true,
  error: null,
};

export const SWITCHES_ERROR = {
  switches: null,
  gmActionsEnabled: false,
  error: 'Foundry did not answer the settings read.',
};
