import { DropdownMenu } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type JSX } from 'react';

import { useEscapeClose } from '../lib/escape';
import { Button } from '../ui';
import {
  MenuPartsContext,
  PickedContext,
  type MenuImplProps,
  type MenuParts,
} from './AdvancedMenu';

const PARTS: MenuParts = { Item: DropdownMenu.Item, Label: DropdownMenu.Label };

/**
 * The Advanced menu with its Radix dropdown (a lazy chunk, see AdvancedMenu.tsx). A Radix dropdown
 * menu, not modal, as on the old page: arrow keys move between the entries, Enter or a click
 * picks one and closes the menu, Escape or a click outside closes it.
 */
export function AdvancedMenuImpl({ children, initialOpen, hadFocus }: MenuImplProps): JSX.Element {
  const [open, setOpen] = useState(initialOpen !== false);
  // Opened by a key press on the stand-in: Radix did not see it, so the first entry is picked here.
  const firstEntry = useRef(initialOpen === 'keyboard');
  // With a toast up, the toast hands Escape on to the newest open panel (escape.ts): this menu.
  useEscapeClose(open, () => setOpen(false));
  // An entry that opened a panel keeps the focus there; Radix would hand it back to the button.
  const picked = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Radix's menu content takes onOpenAutoFocus, but the dropdown's props type leaves it out.
  const openFocus = {
    onOpenAutoFocus: (e: Event): void => {
      if (!firstEntry.current) return;
      firstEntry.current = false;
      e.preventDefault();
      content.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    },
  };
  useLayoutEffect(() => {
    if (hadFocus()) button.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only as the menu mounts
  }, []);
  return (
    <div className="advanced" id="advanced">
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button ref={button} id="btn-advanced" data-track="dash.header.advanced">
            Advanced ▾
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            ref={content}
            className="advanced-menu"
            id="advanced-menu"
            align="end"
            sideOffset={6}
            {...openFocus}
            onCloseAutoFocus={e => {
              if (!picked.current) return;
              picked.current = false;
              e.preventDefault();
            }}
          >
            <MenuPartsContext.Provider value={PARTS}>
              <PickedContext.Provider value={() => (picked.current = true)}>
                {children}
              </PickedContext.Provider>
            </MenuPartsContext.Provider>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
