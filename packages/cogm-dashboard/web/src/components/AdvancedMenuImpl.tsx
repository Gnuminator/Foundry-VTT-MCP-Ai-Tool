import { DropdownMenu } from 'radix-ui';
import { useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { useEscapeClose } from '../lib/escape';
import { Button } from '../ui';
import { MenuPartsContext, type MenuParts } from './AdvancedMenu';

/**
 * The Advanced menu with its Radix dropdown (a lazy chunk, see AdvancedMenu.tsx). A Radix dropdown
 * menu, not modal, as on the old page: arrow keys move between the entries, Enter or a click
 * picks one and closes the menu, Escape or a click outside closes it.
 */
export function AdvancedMenuImpl({
  children,
  initialOpen,
}: {
  children: ReactNode;
  /** The button was clicked while this chunk loaded: open at once. */
  initialOpen: false | 'pointer' | 'keyboard';
}): JSX.Element {
  const [open, setOpen] = useState(initialOpen !== false);
  // With a toast up, the toast hands Escape on to the newest open panel (escape.ts): this menu.
  useEscapeClose(open, () => setOpen(false));
  // An entry that opened a panel keeps the focus there; Radix would hand it back to the button.
  const picked = useRef(false);
  const openedOnce = useRef(false);
  const parts = useMemo<MenuParts>(
    () => ({
      Item: DropdownMenu.Item,
      Label: DropdownMenu.Label,
      picked: (): void => {
        picked.current = true;
      },
    }),
    []
  );
  return (
    <div className="advanced" id="advanced">
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button id="btn-advanced" data-track="dash.header.advanced">
            Advanced ▾
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="advanced-menu"
            id="advanced-menu"
            align="end"
            sideOffset={6}
            onOpenAutoFocus={event => {
              // Opened by the keyboard before this chunk arrived: Radix did not see the key, so
              // the first entry takes the focus here, as it does for a key press on the button.
              if (initialOpen !== 'keyboard' || openedOnce.current) return;
              openedOnce.current = true;
              event.preventDefault();
              (event.currentTarget as HTMLElement)
                .querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
                ?.focus();
            }}
            onCloseAutoFocus={e => {
              if (!picked.current) return;
              picked.current = false;
              e.preventDefault();
            }}
          >
            <MenuPartsContext.Provider value={parts}>{children}</MenuPartsContext.Provider>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
