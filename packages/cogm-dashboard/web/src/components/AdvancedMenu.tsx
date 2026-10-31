import type { DropdownMenu } from 'radix-ui';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Button } from '../ui';
import { useToast } from './Toasts';

/** Tells the menu an entry opened a panel, so the focus stays in that panel. */
export const PickedContext = createContext<() => void>(() => undefined);

/**
 * The Radix parts the entries are made of. They come from the lazy menu chunk (AdvancedMenuImpl),
 * so the first load budget does not carry the dropdown menu; the entries only render inside it.
 */
export interface MenuParts {
  Item: typeof DropdownMenu.Item;
  Label: typeof DropdownMenu.Label;
}
export const MenuPartsContext = createContext<MenuParts | null>(null);

/** What the lazy menu is given. */
export interface MenuImplProps {
  children: ReactNode;
  /** The button was used while the chunk loaded: open at once (a key press also picks the first entry). */
  initialOpen: false | 'pointer' | 'keyboard';
  /** Read once, as the menu mounts: the stand-in button had focus, so the real one takes it. */
  hadFocus: () => boolean;
}

type MenuImpl = ComponentType<MenuImplProps>;
const loadImpl = (): Promise<MenuImpl> =>
  import('./AdvancedMenuImpl').then(m => m.AdvancedMenuImpl);

/** The chunk is fetched this long after the page loads, so the button is ready before it is used. */
const PRELOAD_DELAY_MS = 1000;

/**
 * The Advanced ▾ menu in the header (the old #advanced): the panels and tools that are not part
 * of an evening at the table. Its Radix dropdown menu is a lazy chunk (the first load budget):
 * until it has loaded, a plain button with the same id and look stands in, and a click on it
 * opens the menu as soon as the chunk arrives. If focus was on the stand-in as it was swapped, the
 * real button takes the focus.
 */
export function AdvancedMenu({ children }: { children: ReactNode }): JSX.Element {
  const [Impl, setImpl] = useState<MenuImpl | null>(null);
  const [wanted, setWanted] = useState<MenuImplProps['initialOpen']>(false);
  const focused = useRef(false);
  const loading = useRef(false);
  const failed = useRef(false);
  const clicked = useRef(false);
  const toast = useToast();
  const sayFailed = (): void =>
    toast('The Advanced menu could not load. Reload the page to use it.', 'err');

  const load = (): void => {
    if (loading.current) return;
    loading.current = true;
    loadImpl().then(
      impl => setImpl(() => impl),
      () => {
        // A browser keeps a failed import's answer until the page is reloaded, so there is no
        // second try: the click says so.
        failed.current = true;
        if (clicked.current) sayFailed();
      }
    );
  };
  useEffect(() => {
    const id = setTimeout(load, PRELOAD_DELAY_MS);
    return (): void => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only uses refs and a setter
  }, []);

  if (Impl)
    return (
      <Impl initialOpen={wanted} hadFocus={() => focused.current}>
        {children}
      </Impl>
    );
  return (
    <div className="advanced" id="advanced">
      <Button
        id="btn-advanced"
        data-track="dash.header.advanced"
        onPointerEnter={load}
        onFocus={() => {
          focused.current = true;
          load();
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onClick={e => {
          clicked.current = true;
          if (failed.current) {
            sayFailed();
            return;
          }
          // detail 0: Enter or Space (no pointer click).
          setWanted(e.detail === 0 ? 'keyboard' : 'pointer');
          load();
        }}
      >
        Advanced ▾
      </Button>
    </div>
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
  const picked = useContext(PickedContext);
  const parts = useContext(MenuPartsContext);
  if (!parts) return null;
  return (
    <parts.Item
      asChild
      disabled={disabled}
      onSelect={() => {
        if (onSelect() !== false) picked();
      }}
    >
      {children}
    </parts.Item>
  );
}

/** A small heading over a group of entries (.menu-label). */
export function AdvancedLabel({ children }: { children: ReactNode }): JSX.Element | null {
  const parts = useContext(MenuPartsContext);
  if (!parts) return null;
  return <parts.Label className="menu-label">{children}</parts.Label>;
}
