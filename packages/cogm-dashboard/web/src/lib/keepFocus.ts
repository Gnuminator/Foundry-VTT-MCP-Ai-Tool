import { useEffect, useRef, type RefObject } from 'react';

/**
 * A control that is disabled while its save is on the way loses the keyboard focus in a browser
 * (it falls back to the page start). This gives the focus back once the save has settled: call
 * `remember()` in the handler (before `busy` turns true), and when `busy` goes false again the
 * control is focused if it had the focus then and nothing else took it meanwhile.
 */
export function useKeepFocus<T extends HTMLElement>(
  busy: boolean
): { ref: RefObject<T | null>; remember: () => void } {
  const ref = useRef<T | null>(null);
  const had = useRef(false);

  useEffect(() => {
    if (busy || !had.current) return;
    had.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, [busy]);

  return {
    ref,
    remember: (): void => {
      had.current = document.activeElement === ref.current;
    },
  };
}
