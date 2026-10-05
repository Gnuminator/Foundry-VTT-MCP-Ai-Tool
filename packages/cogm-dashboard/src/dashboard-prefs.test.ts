import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFS,
  DashboardPrefsStore,
  LAYOUT_HINT_SESSIONS,
  isDuringLayout,
  parsePrefsChange,
} from './dashboard-prefs.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cogm-prefs-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('parsePrefsChange', () => {
  it('keeps known, well-typed fields only', () => {
    expect(
      parsePrefsChange({ duringLayout: 'auto', combatButtons: true, extra: 1, duringFull: 'yes' })
    ).toEqual({ duringLayout: 'auto', combatButtons: true });
    expect(parsePrefsChange({ duringLayout: 'grid' })).toBeNull();
    expect(parsePrefsChange(null)).toBeNull();
    expect(parsePrefsChange(['layered'])).toBeNull();
    expect(isDuringLayout('toggle')).toBe(true);
  });
});

describe('DashboardPrefsStore', () => {
  it('starts on layout A with the combat buttons off', () => {
    const store = new DashboardPrefsStore(null);
    expect(store.get(null)).toEqual(DEFAULT_PREFS);
    expect(store.get('strahd').duringLayout).toBe('layered');
    expect(store.get('strahd').combatButtons).toBe(false);
  });

  it('keeps choices per world', async () => {
    const store = new DashboardPrefsStore(null);
    await store.update('strahd', { duringLayout: 'toggle', duringFull: true });
    expect(store.get('strahd')).toMatchObject({ duringLayout: 'toggle', duringFull: true });
    expect(store.get('other').duringLayout).toBe('layered');
  });

  it('counts each session once for the hint, up to the limit', async () => {
    const store = new DashboardPrefsStore(null);
    await store.update('w', { hintSession: 's1' });
    await store.update('w', { hintSession: 's1' });
    for (let i = 2; i <= LAYOUT_HINT_SESSIONS + 2; i++)
      await store.update('w', { hintSession: `s${i}` });
    expect(store.get('w').hintSessions).toHaveLength(LAYOUT_HINT_SESSIONS);
    expect(store.get('w').hintSessions[0]).toBe('s1');
  });

  it('returns copies, so a caller cannot change the stored choices', async () => {
    const store = new DashboardPrefsStore(null);
    await store.update('w', { hintSession: 's1' });
    store.get('w').hintSessions.push('sneaky');
    expect(store.get('w').hintSessions).toEqual(['s1']);
  });

  it('saves to the file and reads it back, dropping bad fields', async () => {
    const file = path.join(dir, 'state', 'dashboard-prefs.json');
    const store = new DashboardPrefsStore(file);
    await store.update('strahd', { duringLayout: 'auto', combatButtons: true, layoutPicked: true });
    expect(new DashboardPrefsStore(file).get('strahd')).toMatchObject({
      duringLayout: 'auto',
      combatButtons: true,
      layoutPicked: true,
    });

    await fsp.writeFile(
      file,
      JSON.stringify({ worlds: { w: { duringLayout: 'grid', combatButtons: 'yes' } } })
    );
    expect(new DashboardPrefsStore(file).get('w')).toEqual(DEFAULT_PREFS);
  });

  it('logs an unreadable file and falls back to the defaults', async () => {
    const file = path.join(dir, 'dashboard-prefs.json');
    await fsp.writeFile(file, '{ not json');
    const warnings: string[] = [];
    const store = new DashboardPrefsStore(file, { warn: (m): number => warnings.push(m) });
    expect(store.get('w')).toEqual(DEFAULT_PREFS);
    expect(warnings).toHaveLength(1);
  });
});
