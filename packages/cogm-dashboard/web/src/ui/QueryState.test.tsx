// QueryState and the state a query puts a panel in. Rendered to a string: no DOM needed.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../lib/api';

import { QueryState, classifyError, panelStateOf, type QueryLike } from './QueryState';

// auth.ts reads the page's location when it loads; there is no page here.
vi.mock('../lib/auth', () => ({ authHeaders: (): Record<string, string> => ({}) }));

const query = <T,>(over: Partial<QueryLike<T>>): QueryLike<T> => ({
  isPending: false,
  isError: false,
  error: null,
  data: undefined,
  ...over,
});

describe('panelStateOf', () => {
  it('is loading while pending, and while there is no data yet', () => {
    expect(panelStateOf(query<string[]>({ isPending: true }))).toBe('loading');
    expect(panelStateOf(query<string[]>({}))).toBe('loading');
  });

  it('is an error when the query failed, even with older data', () => {
    const failed = query<string[]>({ isError: true, error: new Error('x'), data: ['a'] });
    expect(panelStateOf(failed)).toBe('error');
    expect(panelStateOf(failed, { keepData: true })).toBe('ready');
    expect(panelStateOf({ ...failed, data: undefined }, { keepData: true })).toBe('error');
  });

  it('is empty when the caller says the data has nothing to show', () => {
    const isEmpty = (rows: string[]): boolean => rows.length === 0;
    expect(panelStateOf(query<string[]>({ data: [] }), { isEmpty })).toBe('empty');
    expect(panelStateOf(query<string[]>({ data: ['a'] }), { isEmpty })).toBe('ready');
    expect(panelStateOf(query<string[]>({ data: [] }))).toBe('ready');
  });

  it('tells the bridge being down and a switch being off apart only when asked', () => {
    const down = query<string[]>({
      isError: true,
      error: new ApiError('no channel', 502, 'channel'),
    });
    const gated = query<string[]>({
      isError: true,
      error: new ApiError('off', 403, undefined, 'gm-actions-disabled'),
    });
    expect(panelStateOf(down)).toBe('error');
    expect(panelStateOf(down, { detect: true })).toBe('bridge-down');
    expect(panelStateOf(gated, { detect: true })).toBe('gated');
  });
});

describe('classifyError', () => {
  it('leaves any other failure an error', () => {
    expect(classifyError(new Error('boom'))).toBe('error');
    expect(classifyError(new ApiError('bad', 500, 'tool'))).toBe('error');
    expect(classifyError(new ApiError('no', 403, undefined, 'gm-required'))).toBe('error');
  });
});

describe('QueryState', () => {
  const render = (q: QueryLike<string[]>, as?: 'li'): string =>
    renderToStaticMarkup(
      <QueryState
        query={q}
        {...(as ? { as } : {})}
        errorLabel="Couldn't load the rows"
        isEmpty={rows => rows.length === 0}
        empty="No rows."
      >
        {rows => <ul>{rows.map(r => `<${r}>`)}</ul>}
      </QueryState>
    );

  it('shows the old .empty block while loading', () => {
    expect(render(query({ isPending: true }))).toBe(
      '<p class="empty" data-ui-state="loading">Loading…</p>'
    );
  });

  it('says what failed and why', () => {
    const html = render(query({ isError: true, error: new Error('HTTP 500') }));
    expect(html).toContain('class="empty"');
    expect(html).toContain('Couldn&#x27;t load the rows: HTTP 500');
  });

  it('renders as the tag it is given', () => {
    expect(render(query({ data: [] }), 'li')).toBe(
      '<li class="empty" data-ui-state="empty">No rows.</li>'
    );
  });

  it('gives the data to its children when there is something to show', () => {
    expect(render(query({ data: ['a'] }))).toBe('<ul>&lt;a&gt;</ul>');
  });
});
