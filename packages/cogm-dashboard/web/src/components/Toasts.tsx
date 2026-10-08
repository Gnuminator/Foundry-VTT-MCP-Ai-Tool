import * as Toast from '@radix-ui/react-toast';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { usage } from '../lib/usage';

type ToastKind = 'ok' | 'err' | 'warn';

/** The button on an applied change's toast (Undo); a click runs it and closes the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
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
            onOpenChange={open => {
              if (!open) remove(t.id);
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
                onClick={t.action.onClick}
              >
                {t.action.label}
              </Toast.Action>
            )}
          </Toast.Root>
        ))}
        <Toast.Viewport className="toast-stack" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
