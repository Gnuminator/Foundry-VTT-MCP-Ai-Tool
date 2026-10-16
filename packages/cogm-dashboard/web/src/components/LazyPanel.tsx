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

import { LoadingDrawer } from './Drawer';
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
 * one missing panel does not blank the page. It draws nothing, tells the GM once and closes the
 * drawer, so the backdrop does not stay up after the failure. The guard stays failed until a
 * reload (React keeps a failed import's answer), so a later click on the same button opens a
 * backdrop with nothing under it and no second toast. It also catches a render error of a loaded
 * panel, which gets the same toast and close.
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

/** What a drawer shows while its chunk loads: the id and title the real panel has. */
export interface PanelShell {
  id: string;
  title: ReactNode;
}

/**
 * Mounts a lazy panel the first time `show` is true and keeps it mounted after that, so a closed
 * drawer keeps its state and fades out as before. A drawer (`shell` given) shows an empty loading
 * drawer while the chunk loads, so the backdrop is not dimming nothing and a docked slot does not
 * jump when the panel arrives; a pane draws nothing.
 */
export function LazyPanel<F extends PanelFn>({
  chunk,
  show,
  shell,
  ...props
}: { chunk: PanelChunk<F>; show: boolean; shell?: PanelShell } & PropsOf<F>): JSX.Element | null {
  const toast = useToast();
  const [seen, setSeen] = useState<boolean>(show as boolean);
  if (show && !seen) setSeen(true);
  if (!seen) return null;
  const onOpenChange = (props as { onOpenChange?: (open: boolean) => void }).onOpenChange;
  // Typed through a cast: the panel's props are `any`, which would make `shell` `any` too.
  const loadingShell = shell as PanelShell | undefined;
  return (
    <ChunkGuard
      onFail={() => {
        toast('✗ Could not load part of the page. Reload the page to try again.', 'err');
        onOpenChange?.(false);
      }}
    >
      <Suspense
        fallback={
          loadingShell ? (
            <LoadingDrawer
              open={show as boolean}
              onClose={() => onOpenChange?.(false)}
              id={loadingShell.id}
              title={loadingShell.title}
            />
          ) : null
        }
      >
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
