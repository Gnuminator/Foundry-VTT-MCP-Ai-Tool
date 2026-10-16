import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';

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
 * Mounts a lazy panel the first time `show` is true and keeps it mounted after that, so a closed
 * drawer keeps its state and fades out as before. Nothing is drawn while the chunk loads.
 */
export function LazyPanel<F extends PanelFn>({
  chunk,
  show,
  ...props
}: { chunk: PanelChunk<F>; show: boolean } & PropsOf<F>): JSX.Element | null {
  const [seen, setSeen] = useState<boolean>(show as boolean);
  if (show && !seen) setSeen(true);
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <chunk.Panel {...props} />
    </Suspense>
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
