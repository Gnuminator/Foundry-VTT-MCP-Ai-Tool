// Panel: the old page's class names, and which face each state shows. Rendered to a string.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Panel, type PanelState } from './Panel';

// auth.ts reads the page's location when it loads; there is no page here.
vi.mock('../lib/auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

const render = (state: PanelState | undefined, message?: string): string =>
  renderToStaticMarkup(
    <Panel
      title="Party"
      {...(state ? { state } : {})}
      {...(message ? { stateMessage: message } : {})}
    >
      <p>the content</p>
    </Panel>
  );

describe('Panel', () => {
  it('renders the old pane markup around its content', () => {
    const html = renderToStaticMarkup(
      <Panel title="Party" help="dashboard#party" status="3 members" actions={<b>x</b>} foot="end">
        <p>the content</p>
      </Panel>
    );
    expect(html).toContain('<section class="pane">');
    expect(html).toContain('<div class="pane-head"><div class="pane-title"><h2>Party</h2>');
    expect(html).toContain('class="help-q"');
    expect(html).toContain('<span class="pane-meta">3 members</span><b>x</b>');
    expect(html).toContain('<div class="pane-body"><p>the content</p></div>');
    expect(html.endsWith('end</div></section>')).toBe(true);
  });

  it('renders the old drawer markup, with the line under the title', () => {
    const html = renderToStaticMarkup(
      <Panel
        as="aside"
        variant="drawer"
        id="party-drawer"
        title="Party"
        sub="GM only."
        lead={<i />}
      >
        x
      </Panel>
    );
    expect(html).toContain('<aside class="drawer" id="party-drawer">');
    expect(html).toContain('<div class="drawer-head"><div><div class="pane-title">');
    expect(html).toContain('<span class="drawer-sub">GM only.</span>');
    expect(html).toContain('</div><i></i><div class="tarokka-body">x</div>');
  });

  it('shows the content when ready or when no state is given', () => {
    expect(render(undefined)).toContain('the content');
    expect(render('ready')).toContain('the content');
  });

  it.each([
    ['loading', 'Loading…'],
    ['empty', 'Nothing here yet.'],
    ['error', 'Something went wrong.'],
    ['bridge-down', 'The Foundry bridge is not connected.'],
    ['gated', 'This is switched off in the module settings.'],
  ] as const)('shows the %s face instead of the content', (state, text) => {
    const html = render(state);
    expect(html).not.toContain('the content');
    expect(html).toContain(`data-ui-state="${state}"`);
    expect(html).toContain(text);
    expect(html).toContain(`data-panel-state="${state}"`);
  });

  it('takes the message from the panel when it has one', () => {
    expect(render('empty', 'No module errors captured.')).toContain(
      '<p class="empty" data-ui-state="empty">No module errors captured.</p>'
    );
  });

  it('offers Try again on an error only when told how', () => {
    const withRetry = renderToStaticMarkup(
      <Panel title="Party" state="error" onRetry={() => undefined}>
        x
      </Panel>
    );
    expect(withRetry).toContain('Try again');
    expect(render('error')).not.toContain('Try again');
  });
});
