import * as Dialog from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';

import { useEscapeClose } from '../lib/escape';
import { HelpButton } from './HelpButton';

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
  children,
}: OverlayPaneProps): JSX.Element {
  useEscapeClose(open, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Content
        asChild
        aria-describedby={undefined}
        onInteractOutside={e => e.preventDefault()}
      >
        <section id={id} className={['pane', 'overlay-pane', className].filter(Boolean).join(' ')}>
          <div className="pane-head">
            {/* The old page puts the "?" inside the h2; beside it keeps the pane's name the title. */}
            <div className="pane-title">
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              {help !== undefined && <HelpButton page={help} />}
            </div>
            {meta !== undefined && <span className="pane-meta">{meta}</span>}
            <Dialog.Close className="icon-btn overlay-close" title="Close" aria-label={closeLabel}>
              ✕
            </Dialog.Close>
          </div>
          {note}
          <div className={['pane-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
        </section>
      </Dialog.Content>
    </Dialog.Root>
  );
}
