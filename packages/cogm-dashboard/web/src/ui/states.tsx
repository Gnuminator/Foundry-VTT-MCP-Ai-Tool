// The blocks a panel shows instead of its content: loading, nothing yet, an error, the bridge
// being down, a switch being off. They render the old page's `.empty` block (styles.css), so a
// panel that already says "Loading…" or "Couldn't load ..." looks the same after the move.
// Loading is a polite live region (role=status) and the failures are alerts (role=alert), so a
// screen reader hears a panel change face. An <li> keeps its list role: the role goes on a span
// inside it.
import type { JSX, ReactNode } from 'react';

import { errorText } from '../lib/api';

import { Button } from './Button';
import { cx } from './cx';
import styles from './states.module.css';

/** The tag a block renders as: a <p> by default, an <li> inside a list. */
export type BlockTag = 'p' | 'li' | 'div';

interface BlockProps {
  as?: BlockTag;
  className?: string;
}

interface EmptyStateProps extends BlockProps {
  children: ReactNode;
  /** What to do about it (a button); rendered after the text. */
  action?: ReactNode;
}

/** The block's tag with a live-region role: on the tag itself, or on a span inside an <li>. */
function LiveBlock({
  as: Tag,
  role,
  className,
  state,
  children,
}: {
  as: BlockTag;
  role: 'status' | 'alert';
  className: string | undefined;
  state: string;
  children: ReactNode;
}): JSX.Element {
  if (Tag === 'li') {
    return (
      <li className={cx('empty', className)} data-ui-state={state}>
        <span role={role}>{children}</span>
      </li>
    );
  }
  return (
    <Tag className={cx('empty', className)} data-ui-state={state} role={role}>
      {children}
    </Tag>
  );
}

/** Nothing here yet. */
export function EmptyState({
  as: Tag = 'p',
  className,
  children,
  action,
}: EmptyStateProps): JSX.Element {
  return (
    <Tag className={cx('empty', className)} data-ui-state="empty">
      {children}
      {action}
    </Tag>
  );
}

interface LoadingStateProps extends BlockProps {
  children?: ReactNode;
  /** Bars in place of the text, for a panel that is mostly list. */
  skeleton?: boolean | number;
}

/**
 * Waiting for an answer. "Loading…" unless told otherwise. With `skeleton` the text stays for
 * screen readers (visually hidden) and the bars show instead.
 */
export function LoadingState({
  as = 'p',
  className,
  children = 'Loading…',
  skeleton = false,
}: LoadingStateProps): JSX.Element {
  return (
    <LiveBlock as={as} role="status" className={className} state="loading">
      {skeleton === false ? (
        children
      ) : (
        <>
          <Skeleton lines={skeleton === true ? 3 : skeleton} />
          <span className={styles.srOnly}>{children}</span>
        </>
      )}
    </LiveBlock>
  );
}

interface ErrorStateProps extends BlockProps {
  /** The message; when `error` is given too, it follows the message after a colon. */
  children?: ReactNode;
  /** The thing that was thrown. */
  error?: unknown;
  /** Shown as a "Try again" button after the message. */
  onRetry?: () => void;
  /** `bridge-down` and `gated` mark the two failures that are not the panel's own. */
  kind?: 'error' | 'bridge-down' | 'gated';
}

/** Something failed: the message, then the reason when there is one. An alert, every kind. */
export function ErrorState({
  as = 'p',
  className,
  children,
  error,
  onRetry,
  kind = 'error',
}: ErrorStateProps): JSX.Element {
  return (
    <LiveBlock as={as} role="alert" className={className} state={kind}>
      {children}
      {error !== undefined && (children ? ': ' : '')}
      {error !== undefined && errorText(error)}
      {onRetry && (
        <>
          {' '}
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
    </LiveBlock>
  );
}

/**
 * Grey bars where text will be. Decorative: hidden from the accessibility tree (LoadingState keeps
 * its text for screen readers next to them).
 */
export function Skeleton({ lines = 1 }: { lines?: number }): JSX.Element {
  return (
    <span className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.bar} />
      ))}
    </span>
  );
}
