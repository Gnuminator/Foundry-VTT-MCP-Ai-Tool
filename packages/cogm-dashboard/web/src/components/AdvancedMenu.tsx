import type { DropdownMenu } from 'radix-ui';
import {
  Component,
  createContext,
  lazy,
  Suspense,
  useContext,
  startTransition,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Button } from '../ui';

/**
 * What the menu's entries need from the Radix dropdown. The Radix code is the lazy
 * AdvancedMenuImpl chunk (the first load budget, scripts/bundle-budget.mjs); it hands these parts
 * to the entries through this context, so callers keep using AdvancedItem and AdvancedLabel and
 * the entry does not pull Radix's menu in.
 */
export interface MenuParts {
  Item: typeof DropdownMenu.Item;
  Label: typeof DropdownMenu.Label;
  /** Tells the menu an entry opened a panel, so the focus stays in that panel. */
  picked: () => void;
}

export const MenuPartsContext = createContext<MenuParts | null>(null);

const loadImpl = (): Promise<{ default: typeof import('./AdvancedMenuImpl').AdvancedMenuImpl }> =>
  import('./AdvancedMenuImpl').then(m => ({ default: m.AdvancedMenuImpl }));
const Impl = lazy(loadImpl);

/**
 * How long after the page loads the menu's chunk starts to download, so the first data calls get
 * the Pi's connection to themselves. Nothing renders the lazy menu before then (React.lazy only
 * downloads when it is first rendered).
 */
const LOAD_DELAY_MS = 3000;

/** The button that stands in until the menu's chunk has arrived; it looks like the real one. */
function StandIn({
  onClick,
  onFocusChange,
}: {
  onClick: (kind: 'pointer' | 'keyboard') => void;
  onFocusChange: (focused: boolean) => void;
}): JSX.Element {
  return (
    <div className="advanced" id="advanced">
      <Button
        id="btn-advanced"
        data-track="dash.header.advanced"
        aria-haspopup="menu"
        aria-expanded="false"
        data-state="closed"
        onFocus={() => onFocusChange(true)}
        // Moving to another element ends it; losing the button to the swap does not.
        onBlur={e => e.relatedTarget && onFocusChange(false)}
        // detail is 0 for a click that came from Enter or Space.
        onClick={e => onClick(e.detail === 0 ? 'keyboard' : 'pointer')}
      >
        Advanced ▾
      </Button>
    </div>
  );
}

/**
 * The Advanced ▾ menu in the header (the old #advanced): the panels and tools that are not part
 * of an evening at the table. Until its chunk has arrived the same button stands there; a click in
 * that moment opens the menu as soon as it loads. The swap happens in a transition, so the
 * stand-in stays on screen until the real menu is ready, and the focus is handed over.
 */
export function AdvancedMenu({ children }: { children: ReactNode }): JSX.Element {
  const [clicked, setClicked] = useState<false | 'pointer' | 'keyboard'>(false);
  const [ready, setReady] = useState(false);
  const hadFocus = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => startTransition(() => setReady(true)), LOAD_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, []);
  const standIn = (
    <StandIn
      onClick={kind => {
        setClicked(kind);
        startTransition(() => setReady(true));
      }}
      onFocusChange={focused => {
        hadFocus.current = focused;
      }}
    />
  );
  if (!ready) return standIn;
  return (
    <MenuGuard fallback={standIn}>
      <Suspense fallback={standIn}>
        <Impl initialOpen={clicked} restoreFocus={hadFocus.current}>
          {children}
        </Impl>
      </Suspense>
    </MenuGuard>
  );
}

/**
 * Catches a menu chunk that failed to load (the dashboard server was restarted, the network
 * dropped), so the header does not blank the page: the stand-in button stays, as the rest of the
 * page works without the menu. Like LazyPanel's guard, it stays failed until a reload.
 */
class MenuGuard extends Component<
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

/**
 * One entry: the old page's button (id, data-track with its literal name, tooltip) as the child.
 * Picking it runs `onSelect` and closes the menu. `onSelect` returns false when it opened nothing
 * (a pane toggled shut): the focus goes back to the Advanced button then.
 */
export function AdvancedItem({
  onSelect,
  disabled = false,
  children,
}: {
  onSelect: () => boolean | void;
  /** Not available now: the arrow keys skip it and it cannot be picked (the child is disabled too). */
  disabled?: boolean;
  children: ReactElement;
}): JSX.Element | null {
  const parts = useContext(MenuPartsContext);
  if (!parts) return null;
  const { Item, picked } = parts;
  return (
    <Item
      asChild
      disabled={disabled}
      onSelect={() => {
        if (onSelect() !== false) picked();
      }}
    >
      {children}
    </Item>
  );
}

/** A small heading over a group of entries (.menu-label). */
export function AdvancedLabel({ children }: { children: ReactNode }): JSX.Element | null {
  const parts = useContext(MenuPartsContext);
  if (!parts) return null;
  return <parts.Label className="menu-label">{children}</parts.Label>;
}
