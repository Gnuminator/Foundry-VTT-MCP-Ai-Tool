import type { DropdownMenu } from 'radix-ui';
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
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

/** How long after the page loads the menu's chunk is fetched (the first data calls go first). */
const PRELOAD_DELAY_MS = 3000;

/**
 * The Advanced ▾ menu in the header (the old #advanced): the panels and tools that are not part
 * of an evening at the table. Until its chunk arrives the same button stands there; a click in
 * that moment opens the menu as soon as it loads.
 */
export function AdvancedMenu({ children }: { children: ReactNode }): JSX.Element {
  const [clicked, setClicked] = useState<false | 'pointer' | 'keyboard'>(false);
  useEffect(() => {
    const timer = setTimeout(() => void loadImpl().catch(() => undefined), PRELOAD_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, []);
  return (
    <Suspense
      fallback={
        <div className="advanced" id="advanced">
          <Button
            id="btn-advanced"
            data-track="dash.header.advanced"
            aria-haspopup="menu"
            aria-expanded="false"
            data-state="closed"
            // detail is 0 for a click that came from Enter or Space.
            onClick={e => setClicked(e.detail === 0 ? 'keyboard' : 'pointer')}
          >
            Advanced ▾
          </Button>
        </div>
      }
    >
      <Impl initialOpen={clicked}>{children}</Impl>
    </Suspense>
  );
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
