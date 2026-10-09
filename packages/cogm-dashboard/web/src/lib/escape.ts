// Escape and toasts. Radix toasts are dismissable layers, so the newest toast is the top layer
// and Escape would close it instead of the drawer under it: a GM closing a drawer right after a
// change would lose the Undo toast. Toasts hand Escape on to the newest open panel listed here
// instead (Drawer and OverlayPane list themselves while open) and stay up.
import { useEffect, useLayoutEffect, useRef } from 'react';

const panels: { close: () => void }[] = [];

/** Lists a panel while it is open; `close` is what Escape does to it. */
export function useEscapeClose(open: boolean, close: () => void): void {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const entry = { close: (): void => latest.current() };
    panels.push(entry);
    return (): void => {
      panels.splice(panels.indexOf(entry), 1);
    };
  }, [open]);
}

/** Closes the newest open panel, as Escape would without a toast; false when none is open. */
export function closeTopPanel(): boolean {
  const top = panels.at(-1);
  top?.close();
  return top !== undefined;
}
