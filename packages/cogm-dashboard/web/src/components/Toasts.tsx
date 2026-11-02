import { Toast } from 'radix-ui';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { closeTopPanel } from '../lib/escape';
import { usage } from '../lib/usage';

type ToastKind = 'ok' | 'err' | 'warn';

/** The button on an applied change's toast (Undo); a click runs it and closes the toast. */
export interface ToastAction {
  label: string;
  /** A promise keeps the toast up, its button busy, until it settles; then the toast closes. */
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction | undefined;
}

type ShowToast = (text: string, kind?: ToastKind, action?: ToastAction) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

/** The usage code of an error toast, as the old page derives it (an HTTP status or a timeout). */
function toastCode(text: string): string {
  const http = /(?:HTTP|->) (\d{3})\b/.exec(text);
  if (http?.[1]) return http[1];
  return /time(?:d)? ?out/i.test(text) ? 'timeout' : 'error';
}

/** How long a toast stays: errors 6 seconds, an Undo toast 8 (paused while hovered), others 3.5. */
const duration = (t: ToastItem): number => (t.action ? 8000 : t.kind === 'err' ? 6000 : 3500);

/**
 * Escape while a toast shows: the newest toast is the top Radix layer, so it gets the key first.
 * It stays up (the Undo button must survive a GM closing a drawer) and the panel under it closes
 * (lib/escape.ts). Escape on a focused toast still closes that toast.
 */
function handOnEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (event.target instanceof Element && event.target.closest('.toast-stack')) return;
  event.preventDefault();
  closeTopPanel();
}

/**
 * The toast stack (bottom right), styled by styles.css (.toast-stack, .toast.ok/.err/.warn, and
 * .toast-undo with its .toast-action button), with the old page's timings.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback<ShowToast>((text, kind = 'ok', action) => {
    if (kind === 'err') usage().track('error', 'dash.toast.error', { code: toastCode(text) });
    setItems(list => [...list, { id: Date.now() + Math.random(), kind, text, action }]);
  }, []);
  const remove = useCallback((id: number) => {
    setItems(list => list.filter(t => t.id !== id));
  }, []);
  // The toasts whose action is running (Undo): the button says so and ignores a second click; the
  // toast stays up (a timeout or a swipe does not close it) until the action is done.
  const [running, setRunning] = useState<ReadonlySet<number>>(new Set());
  const viewportRef = useRef<HTMLOListElement>(null);
  const runAction = (t: ToastItem, event: { preventDefault(): void }): void => {
    event.preventDefault();
    if (running.has(t.id) || !t.action) return;
    setRunning(set => new Set(set).add(t.id));
    void Promise.resolve(t.action.onClick()).finally(() => {
      setRunning(set => {
        const next = new Set(set);
        next.delete(t.id);
        return next;
      });
      // The button the focus was on goes with the toast: keep the focus in the toast stack.
      if (document.activeElement?.closest('.toast-stack li') !== null) viewportRef.current?.focus();
      remove(t.id);
    });
  };
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right" label="Notification">
        {children}
        {items.map(t => (
          <Toast.Root
            key={t.id}
            className={`toast ${t.kind}${t.action ? ' toast-undo' : ''}`}
            duration={duration(t)}
            onEscapeKeyDown={handOnEscape}
            open
            onOpenChange={open => {
              if (!open && !running.has(t.id)) remove(t.id);
            }}
          >
            <Toast.Description className={t.action ? 'toast-text' : undefined}>
              {t.text}
            </Toast.Description>
            {t.action && (
              <Toast.Action
                className="toast-action"
                altText={`${t.action.label}: ${t.text}`}
                data-track="dash.toast.undo"
                aria-disabled={running.has(t.id) ? true : undefined}
                onClick={event => runAction(t, event)}
              >
                {running.has(t.id) ? 'Working...' : t.action.label}
              </Toast.Action>
            )}
          </Toast.Root>
        ))}
        <Toast.Viewport className="toast-stack" ref={viewportRef} />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
