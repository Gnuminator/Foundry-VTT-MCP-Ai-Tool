/**
 * Tests for the Session and Scene GM windows (I-134 part 2): the session parser, the HTML, the
 * controller's load and mark flows with a fake request, and the scene model.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildSceneView, renderSceneHtml } from './scene-window.js';
import { SessionController, parseSession, renderSessionHtml } from './session-window.js';

const closed = { open: false, startedAt: null, lastEventAt: null, endedAt: '2026-10-18T20:00:00Z' };
const open = { open: true, startedAt: '2026-10-18T18:00:00Z', lastEventAt: null, endedAt: null };

describe('the Session model', () => {
  it('reads an answer and refuses a malformed one', () => {
    expect(parseSession({ success: true, ...open })).toEqual(open);
    expect(() => parseSession({})).toThrow(/unexpected answer/);
    expect(() => parseSession(null)).toThrow(/unexpected answer/);
  });

  it('shows Start when closed and End when open, and disables both while busy', () => {
    const base = { status: 'ready', error: '', busy: false } as const;
    const a = renderSessionHtml({ ...base, session: closed });
    expect(a).toContain('data-action="markStart"');
    expect(a).not.toContain('data-action="markEnd"');
    const b = renderSessionHtml({ ...base, session: open });
    expect(b).toContain('data-action="markEnd"');
    expect(b).toContain('Session open');
    expect(renderSessionHtml({ ...base, session: open, busy: true })).toContain('disabled');
  });

  it('escapes an error and offers Refresh', () => {
    const html = renderSessionHtml({
      status: 'error',
      error: '<img src=x onerror=alert(1)>',
      session: null,
      busy: false,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('data-action="refresh"');
  });
});

describe('the Session controller', () => {
  it('loads the state, then marks a start and reads the state again', async () => {
    const request = vi.fn(async (tool: string) =>
      tool === 'get-play-session' ? { success: true, ...closed } : { success: true }
    );
    const changed = vi.fn();
    const c = new SessionController(request, changed);
    await c.load();
    expect(c.view).toMatchObject({ status: 'ready', session: closed });
    await c.mark('start');
    expect(request.mock.calls.map(call => call[0])).toEqual([
      'get-play-session',
      'mark-play-session',
      'get-play-session',
    ]);
    expect(request).toHaveBeenNthCalledWith(2, 'mark-play-session', { action: 'start' });
    expect(c.view.busy).toBe(false);
  });

  it('shows the error when the bridge is not reachable, and recovers on the next load', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Update the AI Tool bridge to use this window.'))
      .mockResolvedValueOnce({ success: true, ...open });
    const c = new SessionController(request, () => {});
    await c.load();
    expect(c.view).toMatchObject({ status: 'error', error: expect.stringContaining('Update') });
    await c.load();
    expect(c.view).toMatchObject({ status: 'ready', error: '', session: open });
  });

  it('keeps a failed mark as an error and ignores a second click while busy', async () => {
    let release: () => void = () => {};
    const request = vi.fn(
      () =>
        new Promise((_, reject): void => {
          release = (): void => reject(new Error('refused'));
        })
    );
    const c = new SessionController(request, () => {});
    const first = c.mark('end');
    expect(c.view.busy).toBe(true);
    await c.mark('end');
    expect(request).toHaveBeenCalledOnce();
    release();
    await first;
    expect(c.view).toMatchObject({ busy: false, status: 'error', error: 'refused' });
  });

  it('drops a load that a newer one has replaced', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const request = vi.fn(() => new Promise(r => resolvers.push(r)));
    const c = new SessionController(request, () => {});
    const a = c.load();
    const b = c.load();
    resolvers[1]({ success: true, ...open });
    await b;
    resolvers[0]({ success: true, ...closed });
    await a;
    expect(c.view.session).toEqual(open);
  });
});

describe('the Scene model', () => {
  it('reads the name, light, weather and what is playing', () => {
    const view = buildSceneView(
      {
        name: 'Barovia',
        environment: { darknessLevel: 0.7, globalLight: { enabled: true } },
        weather: 'fog',
      },
      [
        { name: 'Dread', sounds: [{ name: 'Wind', playing: true }, { name: 'Bells' }] },
        { name: 'Combat', sounds: [] },
      ]
    );
    expect(view).toMatchObject({
      empty: false,
      name: 'Barovia',
      darkness: 'Dark (70%)',
      globalLight: true,
      weather: 'fog',
      playing: ['Wind (Dread)'],
    });
  });

  it('is empty without a scene and clamps a darkness outside 0 to 1', () => {
    expect(buildSceneView(null, []).empty).toBe(true);
    expect(buildSceneView({ environment: { darknessLevel: 3 } }, []).darkness).toBe(
      'Pitch dark (100%)'
    );
    expect(renderSceneHtml(buildSceneView(null, []))).toContain('No scene is active');
  });

  it('escapes names in the HTML', () => {
    const html = renderSceneHtml(
      buildSceneView({ name: '<b>x</b>', weather: '<i>' }, [
        { name: '<u>', sounds: [{ name: '<s>', playing: true }] },
      ])
    );
    expect(html).not.toMatch(/<(b|i|u|s)>/);
    expect(html).toContain('&lt;b&gt;');
  });
});
