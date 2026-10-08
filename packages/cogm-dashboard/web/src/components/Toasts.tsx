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

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

type ShowToast = (text: string, kind?: ToastKind) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

/** The usage code of an error toast, as the old page derives it (an HTTP status or a timeout). */
function toastCode(text: string): string {
  const http = /(?:HTTP|->) (\d{3})\b/.exec(text);
  if (http?.[1]) return http[1];
  return /time(?:d)? ?out/i.test(text) ? 'timeout' : 'error';
}

/**
 * The toast stack (bottom right), styled by styles.css (.toast-stack, .toast.ok/.err/.warn).
 * Errors stay 6 seconds, the rest 3.5, as on the old page.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback<ShowToast>((text, kind = 'ok') => {
    if (kind === 'err') usage().track('error', 'dash.toast.error', { code: toastCode(text) });
    setItems(list => [...list, { id: Date.now() + Math.random(), kind, text }]);
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
            className={`toast ${t.kind}`}
            duration={t.kind === 'err' ? 6000 : 3500}
            onOpenChange={open => {
              if (!open) remove(t.id);
            }}
          >
            <Toast.Description>{t.text}</Toast.Description>
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
