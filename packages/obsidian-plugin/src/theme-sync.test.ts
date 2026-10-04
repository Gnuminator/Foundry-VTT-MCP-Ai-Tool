import { describe, expect, it, vi } from 'vitest';

import { DashboardError } from './dashboard.js';
import type { ThemeId } from './theme.js';
import { pickTheme, syncTheme, type ThemeClient, type ThemeState } from './theme-sync.js';

const neutral: ThemeState = { theme: 'neutral', themeEnabled: true, pendingTheme: null };

function client(dashboard: { theme: ThemeId; fail?: DashboardError }): ThemeClient & {
  setTheme: ReturnType<typeof vi.fn>;
} {
  return {
    theme: vi.fn(() =>
      dashboard.fail ? Promise.reject(dashboard.fail) : Promise.resolve(dashboard.theme)
    ),
    setTheme: vi.fn((theme: ThemeId) => {
      if (dashboard.fail) return Promise.reject(dashboard.fail);
      dashboard.theme = theme;
      return Promise.resolve(theme);
    }),
  };
}

const offline = new DashboardError('The dashboard did not answer.', 0);
const unknownWorld = new DashboardError('The world is not known yet.', 409);
const notGm = new DashboardError('GM access is required for this action.', 403);

describe('pickTheme', () => {
  it('sets the dashboard theme too', async () => {
    const dash = { theme: 'neutral' as ThemeId };
    const c = client(dash);
    const result = await pickTheme(neutral, 'veil', c);
    expect(c.setTheme).toHaveBeenCalledWith('veil');
    expect(dash.theme).toBe('veil');
    expect(result).toEqual({
      state: { theme: 'veil', themeEnabled: true, pendingTheme: null },
      notice: null,
    });
  });

  it('turns only Obsidian off and leaves the dashboard alone', async () => {
    const c = client({ theme: 'veil' });
    const result = await pickTheme({ ...neutral, theme: 'veil' }, 'off', c);
    expect(c.setTheme).not.toHaveBeenCalled();
    expect(result.state).toEqual({ theme: 'veil', themeEnabled: false, pendingTheme: null });
  });

  it('keeps a pick as pending while the dashboard is offline or has no world yet', async () => {
    for (const fail of [offline, unknownWorld]) {
      const result = await pickTheme(neutral, 'veil', client({ theme: 'neutral', fail }));
      expect(result.state).toEqual({ theme: 'veil', themeEnabled: true, pendingTheme: 'veil' });
      expect(result.notice).toMatch(/Obsidian shows The Veil now/);
    }
  });

  it("keeps the dashboard's theme when it refuses the pick", async () => {
    const c = client({ theme: 'neutral' });
    c.setTheme.mockRejectedValueOnce(notGm);
    const result = await pickTheme(neutral, 'veil', c);
    expect(result.state).toEqual(neutral);
    expect(result.notice).toBe(
      'The dashboard kept its theme: GM access is required for this action.'
    );
  });
});

describe('syncTheme', () => {
  it("takes the dashboard's theme", async () => {
    const state = await syncTheme(neutral, client({ theme: 'veil' }));
    expect(state.theme).toBe('veil');
  });

  it('keeps the last theme while offline', async () => {
    const state = await syncTheme(
      { ...neutral, theme: 'veil' },
      client({ theme: 'neutral', fail: offline })
    );
    expect(state.theme).toBe('veil');
  });

  it('sends a pending pick first, once the dashboard answers', async () => {
    const dash = { theme: 'neutral' as ThemeId };
    const c = client(dash);
    const state = await syncTheme({ theme: 'veil', themeEnabled: true, pendingTheme: 'veil' }, c);
    expect(c.setTheme).toHaveBeenCalledWith('veil');
    expect(dash.theme).toBe('veil');
    expect(state).toEqual({ theme: 'veil', themeEnabled: true, pendingTheme: null });
  });

  it('keeps a pending pick while offline and drops it when refused', async () => {
    const pending: ThemeState = { theme: 'veil', themeEnabled: true, pendingTheme: 'veil' };
    expect(await syncTheme(pending, client({ theme: 'neutral', fail: offline }))).toEqual(pending);
    expect(await syncTheme(pending, client({ theme: 'neutral', fail: notGm }))).toEqual({
      ...pending,
      pendingTheme: null,
    });
  });
});
