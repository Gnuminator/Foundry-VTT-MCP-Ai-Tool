// The one shell for a panel: a head (title, the "?" help, a line under the title, a status, the
// actions), a body, a foot, and six states. Drawer and OverlayPane build on it, so every panel
// has the same bones. It renders the old page's class names (.pane / .drawer, .pane-head /
// .drawer-head, .pane-title, .pane-meta, .pane-body / .tarokka-body), which styles.css and
// moments.css still style; only the foot and the state blocks are new.
import type { ComponentProps, ElementType, JSX, MouseEventHandler, ReactNode } from 'react';

import { HelpButton } from '../components/HelpButton';

import { cx } from './cx';
import styles from './Panel.module.css';
import type { PanelState } from './QueryState';
import { EmptyState, ErrorState, LoadingState } from './states';

export type { PanelState } from './QueryState';

/** What each state says when the panel gives no message of its own. */
const DEFAULT_MESSAGE: Record<Exclude<PanelState, 'ready'>, string> = {
  loading: 'Loading…',
  empty: 'Nothing here yet.',
  error: 'Something went wrong.',
  'bridge-down': 'The Foundry bridge is not connected.',
  gated: 'This is switched off in the module settings.',
};

interface PanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** The element: a section for a pane, an aside for a drawer. */
  as?: 'section' | 'aside' | 'div';
  /** `pane` is the old .pane (head .pane-head, body .pane-body); `drawer` the old .drawer. */
  variant?: 'pane' | 'drawer';
  title: ReactNode;
  /** Gives the title (the h2) an id, for aria-labelledby. */
  titleId?: string | undefined;
  /** Wraps the h2, e.g. in a Radix Dialog.Title. */
  wrapTitle?: ((heading: JSX.Element) => JSX.Element) | undefined;
  /** The guide page (and heading) the "?" after the title opens; no "?" without it. */
  help?: string | undefined;
  /** The line under the title (a drawer's .drawer-sub). */
  sub?: ReactNode;
  /** Short text at the right of the head (.pane-meta). */
  status?: ReactNode;
  /** At the end of the head: the close button, or a row of buttons. */
  actions?: ReactNode;
  /** Between the head and the body: a note, or the drawer's button bar. */
  lead?: ReactNode;
  /** Under the body, outside its scroll. */
  foot?: ReactNode;
  /** Which face to show. Anything but `ready` replaces the body's content. */
  state?: PanelState | undefined;
  /** What a state says instead of the default; an error's reason goes in here too. */
  stateMessage?: ReactNode;
  /** An error block's "Try again". */
  onRetry?: (() => void) | undefined;
  bodyClassName?: string | undefined;
  /** Before everything in the head: the fold button of a During card (components/Folds.tsx). */
  headStart?: ReactNode;
  /** Gives the body an id, for the fold button's aria-controls. */
  bodyId?: string | undefined;
  /** More attributes for the body, e.g. a list role when its children are the items. */
  bodyProps?: Omit<ComponentProps<'div'>, 'className' | 'id' | 'children'> | undefined;
  /**
   * A click on the title text itself (not the "?"), for a folded During card: a pointer shortcut
   * to open it. The title is not focusable, so the fold button is the keyboard path.
   */
  onTitleClick?: MouseEventHandler<HTMLHeadingElement> | undefined;
}

/** The block for a state other than `ready`. */
function StateBlock({
  state,
  message,
  onRetry,
}: {
  state: Exclude<PanelState, 'ready'>;
  message: ReactNode;
  onRetry: (() => void) | undefined;
}): JSX.Element {
  if (state === 'loading') return <LoadingState>{message}</LoadingState>;
  if (state === 'empty') return <EmptyState>{message}</EmptyState>;
  return (
    <ErrorState kind={state} {...(onRetry ? { onRetry } : {})}>
      {message}
    </ErrorState>
  );
}

/**
 * A panel. The rest of the props (id, role, aria-*, tabIndex, a ref) go to the outer element, so
 * a Radix `Dialog.Content asChild` can wrap it.
 */
export function Panel({
  as: Root = 'section',
  variant = 'pane',
  title,
  titleId,
  wrapTitle,
  help,
  sub,
  status,
  actions,
  lead,
  foot,
  state,
  stateMessage,
  onRetry,
  bodyClassName,
  headStart,
  bodyId,
  bodyProps,
  onTitleClick,
  className,
  children,
  ...rest
}: PanelProps): JSX.Element {
  const drawer = variant === 'drawer';
  // A pointer shortcut only: the title is no control, the fold button is.
  const heading = (
    <h2 {...(titleId ? { id: titleId } : {})} {...(onTitleClick ? { onClick: onTitleClick } : {})}>
      {title}
    </h2>
  );
  const titleRow = (
    <div className="pane-title">
      {wrapTitle ? wrapTitle(heading) : heading}
      {help !== undefined && <HelpButton page={help} />}
    </div>
  );
  const Tag = Root as ElementType<ComponentProps<'section'>>;
  const showing = state !== undefined && state !== 'ready' ? state : undefined;
  return (
    <Tag
      className={cx(drawer ? 'drawer' : 'pane', className)}
      {...(state !== undefined ? { 'data-panel-state': state } : {})}
      {...rest}
    >
      <div className={drawer ? 'drawer-head' : 'pane-head'}>
        {headStart}
        {drawer ? (
          <div>
            {titleRow}
            {sub !== undefined && <span className="drawer-sub">{sub}</span>}
          </div>
        ) : (
          titleRow
        )}
        {status !== undefined && <span className="pane-meta">{status}</span>}
        {actions}
      </div>
      {lead}
      <div
        className={cx(drawer ? 'tarokka-body' : 'pane-body', bodyClassName)}
        {...(bodyId ? { id: bodyId } : {})}
        {...(showing ? {} : bodyProps)}
      >
        {showing ? (
          <StateBlock
            state={showing}
            message={stateMessage ?? DEFAULT_MESSAGE[showing]}
            onRetry={onRetry}
          />
        ) : (
          children
        )}
      </div>
      {foot !== undefined && <div className={styles.foot}>{foot}</div>}
    </Tag>
  );
}
