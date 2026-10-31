import { DropdownMenu } from 'radix-ui';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { useEscapeClose } from '../lib/escape';
import { Button } from '../ui';
import { MenuPartsContext, type FocusHandover, type MenuParts } from './AdvancedMenu';

/**
 * The Advanced menu with its Radix dropdown (a lazy chunk, see AdvancedMenu.tsx). A Radix dropdown
 * menu, not modal, as on the old page: arrow keys move between the entries, Enter or a click
 * picks one and closes the menu, Escape or a click outside closes it.
 */
export function AdvancedMenuImpl({
  children,
  initialOpen,
  handover,
}: {
  children: ReactNode;
  /** Set when the stand-in had the focus as it went: this button takes it. */
  handover: FocusHandover;
  /** The button was clicked while this chunk loaded: open at once. */
  initialOpen: false | 'pointer' | 'keyboard';
}): JSX.Element {
  const [open, setOpen] = useState(false);
  // With a toast up, the toast hands Escape on to the newest open panel (escape.ts): this menu.
  useEscapeClose(open, () => setOpen(false));
  // An entry that opened a panel keeps the focus there; Radix would hand it back to the button.
  const picked = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // The stand-in went with the focus (see FocusHandover): this button takes it. It is hidden until
  // the Suspense boundary reveals it, so this tries again for a few frames.
  useLayoutEffect(() => {
    if (!handover.pending) return;
    let frame = 0;
    let tries = 0;
    const give = (): void => {
      const real = document.querySelector<HTMLElement>('#btn-advanced:not([data-standin])');
      real?.focus();
      if (real && document.activeElement === real) {
        handover.pending = false;
      } else if (++tries < 20) {
        frame = requestAnimationFrame(give);
      }
    };
    give();
    return (): void => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the chunk mounts
  }, []);
  // A click while the chunk loaded opens the menu now, after the button has the focus (a menu that
  // opens while the focus is on the page body is closed again by a modal drawer behind it). Opened
  // by the keyboard, Radix did not see the key, so the first entry takes the focus here, as it does
  // for a key press on the button.
  useEffect(() => {
    if (initialOpen === false) return;
    setOpen(true);
    if (initialOpen !== 'keyboard') return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() =>
        contentRef.current
          ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
          ?.focus()
      );
    });
    return (): void => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the chunk mounts
  }, []);
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
            ref={contentRef}
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
