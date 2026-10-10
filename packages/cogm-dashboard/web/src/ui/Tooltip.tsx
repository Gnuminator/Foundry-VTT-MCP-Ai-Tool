import { Tooltip as RadixTooltip } from 'radix-ui';
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  type FocusEvent,
  type RefObject,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import styles from './Tooltip.module.css';

/**
 * Under a TooltipProvider: whether the last thing the person did was press Tab (see Tooltip).
 * Without a provider (a component rendered alone) it is null and Tooltip shows its child as is.
 */
const ProviderContext = createContext<RefObject<boolean> | null>(null);

/**
 * The one provider for every Tooltip, at the app root (main.tsx). It sets the delays: a tooltip
 * opens after a short rest of the pointer, and the next one right away.
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
  return (
    <ProviderContext.Provider value={tabbing}>
      <RadixTooltip.Provider delayDuration={400} skipDelayDuration={300}>
        {children}
      </RadixTooltip.Provider>
    </ProviderContext.Provider>
  );
}

interface TooltipProps {
  /** What the tooltip says. Keep it short; it is a hint, not the control's name. */
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** The one element that gets the tooltip; it must take a ref and the usual DOM props. */
  children: ReactElement<{ onFocus?: (event: FocusEvent<HTMLElement>) => void }>;
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
  if (!tabbing) return children;
  const own = children.props.onFocus;
  const guarded = cloneElement(children, {
    onFocus: (event: FocusEvent<HTMLElement>): void => {
      own?.(event);
      // Radix skips its own handler when the event is default-prevented.
      if (!tabbing.current) event.preventDefault();
    },
  });
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{guarded}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={6}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
