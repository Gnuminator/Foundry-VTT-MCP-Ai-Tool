// Turns a TanStack Query result into the right block, so no panel hand-rolls "Loading…" and
// "Couldn't load ...". Use <QueryState> inside a panel's body, or panelStateOf() to feed
// <Panel state=...>.
import type { JSX, ReactNode } from 'react';

import { ApiError } from '../lib/api';

import { EmptyState, ErrorState, LoadingState, type BlockTag } from './states';

/** The part of a TanStack Query result this file reads (UseQueryResult fits). */
export interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

/** The six faces of a panel. `ready` shows its content, the rest replace it. */
export type PanelState = 'ready' | 'loading' | 'empty' | 'error' | 'bridge-down' | 'gated';

/**
 * Whether an error is the bridge being unreachable (POST /api/tool answered `channel`) or
 * GM Actions being off (403 `gm-actions-disabled`) rather than the panel's own failure.
 */
export function classifyError(error: unknown): 'bridge-down' | 'gated' | 'error' {
  if (error instanceof ApiError) {
    if (error.kind === 'channel') return 'bridge-down';
    if (error.status === 403 && error.code === 'gm-actions-disabled') return 'gated';
  }
  return 'error';
}

interface StateOptions<T> {
  /** True when the answer has nothing to show (an empty list). */
  isEmpty?: (data: T) => boolean;
  /** Keep showing the data of an earlier answer when a refetch failed. */
  keepData?: boolean;
  /** Tell the bridge being down and a switch being off apart from any other error. */
  detect?: boolean;
}

/** Which face a query is in: error first, then waiting, then empty, then ready. */
export function panelStateOf<T>(query: QueryLike<T>, options: StateOptions<T> = {}): PanelState {
  const { isEmpty, keepData = false, detect = false } = options;
  if (query.isError && !(keepData && query.data !== undefined)) {
    return detect ? classifyError(query.error) : 'error';
  }
  if (query.isPending || query.data === undefined) return 'loading';
  return isEmpty?.(query.data) ? 'empty' : 'ready';
}

interface QueryStateProps<T> extends StateOptions<T> {
  query: QueryLike<T>;
  /** The content, given the data; rendered only when there is something to show. */
  children: (data: T) => ReactNode;
  /** The tag the loading, empty and error blocks render as (an <li> inside a list). */
  as?: BlockTag;
  /** Replaces "Loading…". */
  loading?: ReactNode;
  /** "Couldn't load the party": the reason follows after a colon. */
  errorLabel: string;
  /** What the empty block says, or a function of the data for more than one case. */
  empty?: ReactNode | ((data: T) => ReactNode);
  /** Called by the "Try again" button of an error block; no button without it. */
  onRetry?: () => void;
}

/**
 * The query's data through `children`, or the block for its state. The blocks are the old
 * `.empty` ones, so a panel looks the same as with its own markup.
 */
export function QueryState<T>({
  query,
  children,
  as,
  loading,
  errorLabel,
  empty,
  isEmpty,
  keepData,
  detect,
  onRetry,
}: QueryStateProps<T>): JSX.Element {
  const state = panelStateOf(query, {
    ...(isEmpty ? { isEmpty } : {}),
    ...(keepData !== undefined ? { keepData } : {}),
    ...(detect !== undefined ? { detect } : {}),
  });
  const tag = as ? { as } : {};
  if (state === 'loading') return <LoadingState {...tag}>{loading}</LoadingState>;
  if (state === 'empty') {
    const message = typeof empty === 'function' ? empty(query.data as T) : empty;
    return <EmptyState {...tag}>{message ?? 'Nothing here yet.'}</EmptyState>;
  }
  if (state === 'ready') return <>{children(query.data as T)}</>;
  return (
    <ErrorState {...tag} kind={state} error={query.error} {...(onRetry ? { onRetry } : {})}>
      {errorLabel}
    </ErrorState>
  );
}
