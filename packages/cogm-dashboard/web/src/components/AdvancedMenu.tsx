import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  createContext,
  useContext,
  useRef,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useEscapeClose } from '../lib/escape';

/** Tells the menu an entry opened a panel, so the focus stays in that panel. */
const PickedContext = createContext<() => void>(() => undefined);

/**
 * The Advanced ▾ menu in the header (the old #advanced): the panels and tools that are not part
 * of an evening at the table. A Radix dropdown menu, not modal, as on the old page: arrow keys
 * move between the entries, Enter or a click picks one and closes the menu, Escape or a click
 * outside closes it.
 */
export function AdvancedMenu({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  // With a toast up, the toast hands Escape on to the newest open panel (escape.ts): this menu.
  useEscapeClose(open, () => setOpen(false));
  // An entry that opened a panel keeps the focus there; Radix would hand it back to the button.
  const picked = useRef(false);
  return (
    <div className="advanced" id="advanced">
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button id="btn-advanced" className="btn" data-track="dash.header.advanced">
            Advanced ▾
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="advanced-menu"
            id="advanced-menu"
            align="end"
            sideOffset={6}
            onCloseAutoFocus={e => {
              if (!picked.current) return;
              picked.current = false;
              e.preventDefault();
            }}
          >
            <PickedContext.Provider value={() => (picked.current = true)}>
              {children}
            </PickedContext.Provider>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
  children,
}: {
  onSelect: () => boolean | void;
  children: ReactElement;
}): JSX.Element {
  const picked = useContext(PickedContext);
  return (
    <DropdownMenu.Item
      asChild
      onSelect={() => {
        if (onSelect() !== false) picked();
      }}
    >
      {children}
    </DropdownMenu.Item>
  );
}

/** A small heading over a group of entries (.menu-label). */
export function AdvancedLabel({ children }: { children: ReactNode }): JSX.Element {
  return <DropdownMenu.Label className="menu-label">{children}</DropdownMenu.Label>;
}
