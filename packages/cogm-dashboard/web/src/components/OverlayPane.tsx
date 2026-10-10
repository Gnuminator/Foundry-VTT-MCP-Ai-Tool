import { Dialog } from 'radix-ui';
import type { JSX, ReactNode } from 'react';

import { closeTopPanel, useEscapeClose } from '../lib/escape';
import { IconButton, Panel, type PanelState } from '../ui';

interface OverlayPaneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Short text next to the title (.pane-meta). */
  meta?: ReactNode;
  /** The close button's accessible name, e.g. "Close player links". */
  closeLabel: string;
  /** The old page's id, where styles.css styles the pane by it (e.g. pane-diagnostics). */
  id?: string;
  /** Extra classes on the pane and on its body (e.g. help-pane, help-body). */
  className?: string;
  bodyClassName?: string;
  /** The guide page and heading the "?" after the title opens (help-links.json on the old page). */
  help?: string;
  /** A line between the head and the body (e.g. the diagnostics space note). */
  note?: ReactNode;
  /** Which face of the panel to show (Panel's states); the children show when it is ready. */
  state?: PanelState;
  /** What the state says instead of its default. */
  stateMessage?: ReactNode;
  children: ReactNode;
}

/**
 * A panel over the page (the old .overlay-pane: AI commentary, diagnostics, player links). A
 * non-modal Radix dialog: Escape and the ✕ close it, the page behind stays usable, and a click
 * outside leaves it open (the header button toggles it, as before).
 */
export function OverlayPane({
  open,
  onOpenChange,
  title,
  meta,
  closeLabel,
  id,
  className,
  bodyClassName,
  help,
  note,
  state,
  stateMessage,
  children,
}: OverlayPaneProps): JSX.Element {
  useEscapeClose(open, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Content
        asChild
        aria-describedby={undefined}
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => {
          // One order for Escape across panes and drawers: the newest open panel (escape.ts).
          e.preventDefault();
          closeTopPanel();
        }}
      >
        <Panel
          id={id}
          className={['overlay-pane', className].filter(Boolean).join(' ')}
          title={title}
          // The old page puts the "?" inside the h2; beside it keeps the pane's name the title.
          wrapTitle={h2 => <Dialog.Title asChild>{h2}</Dialog.Title>}
          help={help}
          status={meta}
          lead={note}
          bodyClassName={bodyClassName}
          state={state}
          stateMessage={stateMessage}
          actions={
            <Dialog.Close asChild>
              <IconButton className="overlay-close" label={closeLabel} tip="Close (Esc)">
                ✕
              </IconButton>
            </Dialog.Close>
          }
        >
          {children}
        </Panel>
      </Dialog.Content>
    </Dialog.Root>
  );
}
