import {
  Component,
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
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

/** The chunk is fetched this long after the provider mounts. */
const PRELOAD_DELAY_MS = 3000;

/** Catches a failed ToastStack chunk (a restarted server, a dropped network): the page stays up. */
class StackGuard extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** What shows when the Radix stack cannot load: the texts and any action, each gone after 6 s. */
function PlainStack({
  items,
  remove,
}: {
  items: ToastItem[];
  remove: (id: number) => void;
}): JSX.Element {
  useEffect(() => {
    const timers = items.map(t => window.setTimeout(() => remove(t.id), t.action ? 8000 : 6000));
    return (): void => timers.forEach(id => window.clearTimeout(id));
  }, [items, remove]);
  return (
    <ol className="toast-stack" aria-live="polite">
      {items.map(t => (
        <li key={t.id} className={`toast ${t.kind}${t.action ? ' toast-undo' : ''}`}>
          <span className={t.action ? 'toast-text' : undefined}>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                void Promise.resolve(t.action?.onClick()).finally(() => remove(t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

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
  // Fetch the chunk a few seconds after the page loads, so the first toast is not waiting for it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('./ToastStack').catch(() => undefined);
    }, PRELOAD_DELAY_MS);
    return (): void => window.clearTimeout(timer);
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {shown && (
        <StackGuard fallback={<PlainStack items={items} remove={remove} />}>
          <Suspense fallback={null}>
            <ToastStack items={items} remove={remove} persistent={persistent} />
          </Suspense>
        </StackGuard>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
