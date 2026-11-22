import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { usage } from '../lib/usage';
import type { ToastAction, ToastItem } from './ToastStack';

export type { ToastAction } from './ToastStack';

type ToastKind = 'ok' | 'err' | 'warn';

/** `code` is the usage code of an error toast when the caller knows it (the failed call's kind or status). */
type ShowToast = (text: string, kind?: ToastKind, action?: ToastAction, code?: string) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

// Radix Toast lives in its own chunk (the first load budget); it downloads on the first toast.
const ToastStack = lazy(() => import('./ToastStack'));

/** The usage code of an error toast from its text, when the caller gave none (a status or a timeout). */
function toastCode(text: string): string {
  const http = /(?:HTTP|->) (\d{3})\b/.exec(text);
  if (http?.[1]) return http[1];
  return /time(?:d)? ?out/i.test(text) ? 'timeout' : 'error';
}

/**
 * The toast provider: the state and `useToast` stay here; the stack on screen (bottom right) is
 * ToastStack, mounted from the first toast on.
 */
export function ToastProvider({
  children,
  persistent = false,
}: {
  children: ReactNode;
  /** Toasts never time out (Storybook, so a story shot still has them on screen). */
  persistent?: boolean;
}): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [shown, setShown] = useState(false);
  const show = useCallback<ShowToast>((text, kind = 'ok', action, code) => {
    if (kind === 'err') {
      usage().track('error', 'dash.toast.error', { code: code ?? toastCode(text) });
    }
    setShown(true);
    setItems(list => [...list, { id: Date.now() + Math.random(), kind, text, action }]);
  }, []);
  const remove = useCallback((id: number) => {
    setItems(list => list.filter(t => t.id !== id));
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {shown && (
        <Suspense fallback={null}>
          <ToastStack items={items} remove={remove} persistent={persistent} />
        </Suspense>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
