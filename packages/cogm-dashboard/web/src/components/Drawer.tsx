import { Dialog } from 'radix-ui';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { closeTopPanel, raisePanel, useEscapeClose } from '../lib/escape';
import { cx, IconButton, Panel, type PanelState } from '../ui';

import { useCardFold } from './Folds';

// Every drawer sits in the same place, so without help the one later in the page covers the
// others: the GM Actions gate would open Pre-flight under the drawer that asked for it. The drawer
// opened last goes on top instead, the same one Escape closes first.
let openOrder: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const topDrawer = (): string | undefined => openOrder.at(-1);
function setOpenOrder(next: string[]): void {
  openOrder = next;
  for (const listener of listeners) listener();
}

/**
 * Brings an open drawer to the top again (the GM Actions gate asks for Pre-flight while it is
 * open under another drawer); Escape closes it first from then on. Nothing when it is closed: it
 * goes on top when it opens.
 */
export function raiseDrawer(id: string): void {
  if (!openOrder.includes(id)) return;
  setOpenOrder([...openOrder.filter(d => d !== id), id]);
  raisePanel(id);
}

/** Whether this drawer is the one opened last (or raised last) of those open now. */
function useOnTop(id: string, open: boolean): boolean {
  useLayoutEffect(() => {
    if (!open) return;
    setOpenOrder([...openOrder.filter(d => d !== id), id]);
    return (): void => setOpenOrder(openOrder.filter(d => d !== id));
  }, [id, open]);
  return useSyncExternalStore(subscribe, topDrawer) === id;
}

/**
 * The view slot a drawer sits in (Moments.tsx), or null when it floats. App wraps each panel that
 * can dock in a provider, so the panels themselves do not know about docking.
 */
export const DockContext = createContext<HTMLElement | null>(null);

/**
 * A wrapper element that holds a docked drawer and moves into whichever slot it docks in. React
 * portals into the same element all along, so a drawer docked in two moments (Prep in Before and
 * After) keeps its state and its data when the moment changes; only the wrapper moves.
 */
function useDockHost(slot: HTMLElement | null): HTMLElement {
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.className = 'dock-host';
    return el;
  });
  useLayoutEffect(() => {
    if (!slot) return;
    slot.appendChild(host);
    return (): void => host.remove();
  }, [slot, host]);
  return host;
}

/** Whether this drawer sits in the page now. */
export function isDocked(id: string): boolean {
  return document.getElementById(id)?.classList.contains('docked') ?? false;
}

/**
 * Shows a docked drawer: scrolls it into view and gives it the focus. The header and menu buttons
 * do this instead of opening a second copy over the page. False when it is not docked.
 */
export function showDocked(id: string): boolean {
  const el = document.getElementById(id);
  if (!el || !isDocked(id)) return false;
  el.scrollIntoView({ block: 'nearest' });
  el.focus({ preventScroll: true });
  return true;
}

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The old page's id (preflight-drawer, ...); styles.css and help-links.json key on it. */
  id: string;
  title: ReactNode;
  /** The line under the title (.drawer-sub). */
  sub?: ReactNode;
  /** The close button: a <DrawerClose data-track="dash.<name>.close" /> with its literal name. */
  close: ReactElement;
  /** The guide page and heading the "?" after the title opens. */
  help?: string;
  /** Escape closed it (the panel reports its own dash.shortcut.escape-<name>). */
  onEscape?: () => void;
  /**
   * Escape is about to close it: true when the panel used the key itself (it closed a menu of its
   * own), and the drawer stays open.
   */
  onEscapeKey?: () => boolean;
  /** Radix's focus move on opening; preventDefault() and focus something else to take its place. */
  onOpenAutoFocus?: (event: Event) => void;
  /** The bar under the head (.tarokka-actions on the old page). */
  actions?: ReactNode;
  bodyClassName?: string;
  /** Which face of the panel to show (Panel's states); the children show when it is ready. */
  state?: PanelState;
  /** What the state says instead of its default. */
  stateMessage?: ReactNode;
  children: ReactNode;
}

/** The ✕ in a drawer's head. */
export function DrawerClose(props: ComponentProps<'button'>): JSX.Element {
  return (
    <Dialog.Close asChild>
      <IconButton label="Close" tip="Close (Esc)" {...props}>
        ✕
      </IconButton>
    </Dialog.Close>
  );
}

/**
 * A drawer from the right (the old aside.drawer: Pre-flight, Prep, Party, ...). A non-modal Radix
 * dialog: several can be open, Escape closes the top one (escape.ts), ✕ closes this one, and a click on the
 * backdrop (DrawerBackdrop, in App) closes them all. Other clicks outside leave it open.
 *
 * Docked (a DockContext slot is given), it sits in the page instead: a labelled region with no
 * close button, no backdrop and no place in the Escape order. The panel keeps `open` true while
 * it is docked, so it loads and counts its view as when it is open.
 */
export function Drawer({
  open,
  onOpenChange,
  id,
  title,
  sub,
  close,
  help,
  onEscape,
  onEscapeKey,
  onOpenAutoFocus,
  actions,
  bodyClassName,
  state,
  stateMessage,
  children,
}: DrawerProps): JSX.Element {
  const dockSlot = useContext(DockContext);
  // In During a docked drawer is a fold card (Folds.tsx): a button first in the head, and a
  // folded one shows only its head. The body stays mounted, so the data stays.
  const fold = useCardFold();
  const slot = open ? dockSlot : null;
  const host = useDockHost(slot);
  const floating = open && !dockSlot;
  useEscapeClose(
    floating,
    () => {
      if (onEscapeKey?.()) return;
      onEscape?.();
      onOpenChange(false);
    },
    id
  );
  const onTop = useOnTop(id, floating);
  // The bar under the head (.tarokka-actions on the old page).
  const bar = actions !== undefined ? <div className="tarokka-actions">{actions}</div> : undefined;
  const shell = {
    as: 'aside',
    variant: 'drawer',
    id,
    title,
    help,
    sub,
    lead: bar,
    bodyClassName,
    state,
    stateMessage,
  } as const;
  if (slot) {
    // tabIndex -1: showDocked and the moment change can hand it the focus.
    return createPortal(
      <Panel
        {...shell}
        titleId={`${id}-title`}
        className={cx('docked', fold?.folded && 'is-folded')}
        role="region"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        {...(fold
          ? {
              headStart: fold.button,
              bodyId: `${id}-body`,
              onTitleClick: fold.folded ? fold.toggle : undefined,
            }
          : {})}
      >
        {children}
      </Panel>,
      host
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Content
        asChild
        aria-describedby={undefined}
        onInteractOutside={e => e.preventDefault()}
        {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
        onEscapeKeyDown={e => {
          // Radix gives the key to the drawer mounted last, which is not the top one once another
          // drawer was raised: the newest panel in escape.ts's list closes instead.
          e.preventDefault();
          closeTopPanel();
        }}
      >
        <Panel
          {...shell}
          wrapTitle={h2 => <Dialog.Title asChild>{h2}</Dialog.Title>}
          actions={close}
          {...(onTop ? { className: 'drawer-top' } : {})}
        >
          {children}
        </Panel>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The dimmed page behind open drawers; a click closes every one of them. */
export function DrawerBackdrop({
  shown,
  onClose,
}: {
  shown: boolean;
  onClose: () => void;
}): JSX.Element | null {
  if (!shown) return null;
  return <div className="drawer-backdrop" data-track="dash.drawer.backdrop" onClick={onClose} />;
}
