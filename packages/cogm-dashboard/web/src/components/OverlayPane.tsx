import * as Dialog from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';

interface OverlayPaneProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Short text next to the title (.pane-meta). */
  meta?: ReactNode;
  /** The close button's accessible name, e.g. "Close player links". */
  closeLabel: string;
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
  children,
}: OverlayPaneProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Content
        asChild
        aria-describedby={undefined}
        onInteractOutside={e => e.preventDefault()}
      >
        <section className="pane overlay-pane">
          <div className="pane-head">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            {meta !== undefined && <span className="pane-meta">{meta}</span>}
            <Dialog.Close className="icon-btn overlay-close" title="Close" aria-label={closeLabel}>
              ✕
            </Dialog.Close>
          </div>
          <div className="pane-body">{children}</div>
        </section>
      </Dialog.Content>
    </Dialog.Root>
  );
}
