import { Popover as RadixPopover } from 'radix-ui';
import type { JSX, ReactElement, ReactNode } from 'react';

import styles from './Popover.module.css';

interface PopoverProps {
  /** The control that opens it (one element: a Button, an IconButton). */
  trigger: ReactElement;
  /** The popover's accessible name. */
  label: string;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A small panel that opens beside a control and holds more than a tooltip can (a few lines, a
 * link, a button). Not modal: the page behind stays usable. Escape or a click outside closes it
 * and the focus goes back to the trigger.
 */
export function Popover({
  trigger,
  label,
  children,
  side = 'bottom',
  align = 'center',
  open,
  defaultOpen,
  onOpenChange,
}: PopoverProps): JSX.Element {
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          className={styles.content}
          aria-label={label}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
