import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

type Impl = typeof import('../components/TooltipImpl').TooltipImpl;

// The Radix tooltip is a lazy chunk (the first load budget): it is fetched a moment after the page
// loads, or at once when a tooltip's control is first touched. Until then a control shows as is.
let implPromise: Promise<Impl> | null = null;
let loaded: Impl | null = null;
function loadImpl(): Promise<Impl> {
  implPromise ??= import('../components/TooltipImpl').then(m => {
    loaded = m.TooltipImpl;
    return loaded;
  });
  return implPromise;
}

/** Loads the Radix chunk now (Storybook does, so a story shows its tip as the page does later). */
export async function preloadTooltips(): Promise<void> {
  await loadImpl();
}

/** The chunk is fetched this long after a first tooltip mounts. */
const PRELOAD_DELAY_MS = 1000;

/**
 * Under a TooltipProvider: whether the last thing the person did was press Tab (see Tooltip).
 * Without a provider (a component rendered alone) it is null and Tooltip shows its child as is.
 */
const ProviderContext = createContext<RefObject<boolean> | null>(null);

/**
 * The one provider for every Tooltip, at the app root (main.tsx). It follows whether the last
 * input was Tab; the delays are set by each tooltip (TooltipImpl).
 */
export function TooltipProvider({ children }: { children: ReactNode }): JSX.Element {
  const tabbing = useRef(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      tabbing.current = event.key === 'Tab';
    };
    const onPointer = (): void => {
      tabbing.current = false;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return (): void => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return <ProviderContext.Provider value={tabbing}>{children}</ProviderContext.Provider>;
}

interface TooltipProps {
  /** What the tooltip says. Keep it short; it is a hint, not the control's name. */
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** The one element that gets the tooltip; it must take a ref and the usual DOM props. */
  children: ReactElement<{
    onFocus?: (event: FocusEvent<HTMLElement>) => void;
    onBlur?: (event: FocusEvent<HTMLElement>) => void;
    onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  }>;
}

/**
 * A hint on hover or keyboard focus, for a control whose look does not say what it does (an icon
 * button). It is not the control's name: keep the `aria-label`, which stays the accessible name.
 * Radix adds `aria-describedby` while the hint is open. Escape closes it and the focus stays
 * where it was.
 *
 * Only a focus that comes from Tab opens it. A focus the page moves itself (a drawer handing the
 * focus to its first button as it opens, after a click or after Enter on a menu entry) does not:
 * that would put a tip on screen nobody asked for.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps): JSX.Element {
  const tabbing = useContext(ProviderContext);
  const [Impl, setImpl] = useState<Impl | null>(() => loaded);
  // Swapping in the Radix tree remounts the control, which would drop its focus: while it has
  // focus the swap waits for the blur.
  const focused = useRef(false);
  const pending = useRef<Impl | null>(null);
  const apply = useCallback((impl: Impl): void => {
    if (focused.current) pending.current = impl;
    else setImpl(() => impl);
  }, []);
  useEffect(() => {
    if (!tabbing || Impl) return;
    let live = true;
    const start = (): void => {
      void loadImpl().then(
        impl => {
          if (live) apply(impl);
        },
        () => undefined
      );
    };
    const timer = window.setTimeout(start, PRELOAD_DELAY_MS);
    return (): void => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [tabbing, Impl, apply]);
  if (!tabbing) return children;
  const own = children.props.onFocus;
  const ownBlur = children.props.onBlur;
  const ownEnter = children.props.onPointerEnter;
  const guarded = cloneElement(children, {
    onFocus: (event: FocusEvent<HTMLElement>): void => {
      focused.current = true;
      own?.(event);
      // Radix skips its own handler when the event is default-prevented.
      if (!tabbing.current) event.preventDefault();
    },
    onBlur: (event: FocusEvent<HTMLElement>): void => {
      focused.current = false;
      ownBlur?.(event);
      const impl = pending.current;
      pending.current = null;
      if (impl) setImpl(() => impl);
    },
    onPointerEnter: (event: PointerEvent<HTMLElement>): void => {
      ownEnter?.(event);
      // A touch has no hover; a swap under the finger could eat the tap.
      if (event.pointerType !== 'mouse') return;
      void loadImpl().then(apply, () => undefined);
    },
  });
  return Impl ? <Impl content={content} side={side} trigger={guarded} /> : guarded;
}
