import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';

import { useToast } from './Toasts';

/** A panel component as the lazy chunk exports it, whatever its props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSX component type needs `any` props
type PanelFn = (props: any) => ReactNode;

type PropsOf<F> = F extends (props: infer P) => ReactNode ? P : never;

/**
 * A panel loaded from its own chunk (the first load budget, scripts/bundle-budget.mjs). `load` is
 * the dynamic import; it stays a function so App can start the download early (`usePreloadPanels`)
 * and the panel itself appears the first time it is shown.
 */
export interface PanelChunk<F extends PanelFn> {
  load: () => Promise<unknown>;
  Panel: ComponentType<object>;
  /** Type only: the panel's props. */
  props?: PropsOf<F>;
}

export function panelChunk<F extends PanelFn>(load: () => Promise<{ default: F }>): PanelChunk<F> {
  return {
    load,
    Panel: lazy(load as unknown as () => Promise<{ default: ComponentType<object> }>),
  };
}

/**
 * Catches a chunk that failed to load (the dashboard server was restarted, the network dropped), so
 * one missing panel does not blank the page. It draws nothing and tells the GM once; the rest of
 * the page goes on, and a reload brings the panel back (React keeps a failed import's answer).
 */
class ChunkGuard extends Component<
  { onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    this.props.onFail();
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Mounts a lazy panel the first time `show` is true and keeps it mounted after that, so a closed
 * drawer keeps its state and fades out as before. Nothing is drawn while the chunk loads.
 */
export function LazyPanel<F extends PanelFn>({
  chunk,
  show,
  ...props
}: { chunk: PanelChunk<F>; show: boolean } & PropsOf<F>): JSX.Element | null {
  const toast = useToast();
  const [seen, setSeen] = useState<boolean>(show as boolean);
  if (show && !seen) setSeen(true);
  if (!seen) return null;
  return (
    <ChunkGuard
      onFail={() =>
        toast('✗ Could not load part of the page. Reload the page to try again.', 'err')
      }
    >
      <Suspense fallback={null}>
        <chunk.Panel {...props} />
      </Suspense>
    </ChunkGuard>
  );
}

/**
 * Starts the downloads: `now` right after the first render (panels that dock into a view, so they
 * are on the page almost at once), `idle` when the browser has nothing else to do (the floating
 * ones, so the first open is not a wait).
 */
export function usePreloadPanels(
  now: readonly PanelChunk<PanelFn>[],
  idle: readonly PanelChunk<PanelFn>[]
): void {
  useEffect(() => {
    const run = (chunks: readonly PanelChunk<PanelFn>[]) => (): void => {
      for (const c of chunks) void c.load().catch(() => undefined);
    };
    run(now)();
    const later = run(idle);
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(later, { timeout: 4000 });
      return (): void => cancelIdleCallback(id);
    }
    const id = setTimeout(later, 1500);
    return (): void => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the chunk lists are module constants
  }, []);
}
