// Escape and toasts. Radix toasts are dismissable layers, so the newest toast is the top layer
// and Escape would close it instead of the drawer under it: a GM closing a drawer right after a
// change would lose the Undo toast. Toasts hand Escape on to the newest open panel listed here
// instead (Drawer and OverlayPane list themselves while open) and stay up.
import { useEffect, useLayoutEffect, useRef } from 'react';

const panels: { id: string | undefined; close: () => void }[] = [];

/**
 * Lists a panel while it is open; `close` is what Escape does to it. A panel with an `id` can be
 * raised (raisePanel) when it is brought to the front again while open.
 */
export function useEscapeClose(open: boolean, close: () => void, id?: string): void {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const entry = { id, close: (): void => latest.current() };
    panels.push(entry);
    return (): void => {
      panels.splice(panels.indexOf(entry), 1);
    };
  }, [open, id]);
}

/** Makes an open panel the newest, so Escape closes it first; nothing when it is not open. */
export function raisePanel(id: string): void {
  const i = panels.findIndex(p => p.id === id);
  if (i >= 0) panels.push(...panels.splice(i, 1));
}

/** Whether a panel listed here is open (a drawer over the page, a pane, the menu, a confirm window). */
export function hasOpenPanel(): boolean {
  return panels.length > 0;
}

/**
 * Whether a Radix popup (a Popover, Tooltip or Select) is open: they are not panels listed here,
 * but each lives in a popper wrapper while it is open. Escape closes the popup first and leaves
 * what is behind it alone (the layout trial, for one).
 */
export function hasOpenPopper(): boolean {
  return document.querySelector('[data-radix-popper-content-wrapper]') !== null;
}

/** Closes the newest open panel, as Escape would without a toast; false when none is open. */
export function closeTopPanel(): boolean {
  const top = panels.at(-1);
  top?.close();
  return top !== undefined;
}
