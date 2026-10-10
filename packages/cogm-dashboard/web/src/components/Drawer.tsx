import * as Dialog from '@radix-ui/react-dialog';
import {
  useLayoutEffect,
  useSyncExternalStore,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { closeTopPanel, raisePanel, useEscapeClose } from '../lib/escape';
import { HelpButton } from './HelpButton';

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
  children: ReactNode;
}

/** The ✕ in a drawer's head. */
export function DrawerClose(props: ComponentProps<'button'>): JSX.Element {
  return (
    <Dialog.Close className="icon-btn" title="Close" aria-label="Close" {...props}>
      ✕
    </Dialog.Close>
  );
}

/**
 * A drawer from the right (the old aside.drawer: Pre-flight, Prep, Party, ...). A non-modal Radix
 * dialog: several can be open, Escape closes the top one (escape.ts), ✕ closes this one, and a click on the
 * backdrop (DrawerBackdrop, in App) closes them all. Other clicks outside leave it open.
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
  children,
}: DrawerProps): JSX.Element {
  useEscapeClose(
    open,
    () => {
      if (onEscapeKey?.()) return;
      onEscape?.();
      onOpenChange(false);
    },
    id
  );
  const onTop = useOnTop(id, open);
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
        <aside id={id} className={onTop ? 'drawer drawer-top' : 'drawer'}>
          <div className="drawer-head">
            <div>
              <div className="pane-title">
                <Dialog.Title asChild>
                  <h2>{title}</h2>
                </Dialog.Title>
                {help !== undefined && <HelpButton page={help} />}
              </div>
              {sub !== undefined && <span className="drawer-sub">{sub}</span>}
            </div>
            {close}
          </div>
          {actions !== undefined && <div className="tarokka-actions">{actions}</div>}
          <div className={['tarokka-body', bodyClassName].filter(Boolean).join(' ')}>
            {children}
          </div>
        </aside>
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
