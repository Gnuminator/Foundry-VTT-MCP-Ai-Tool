// For a drawer or a pane story: holds the `open` state the panel wants, starts open, and offers a
// "Reopen" button once the story closes it (the ✕ or Escape), so a closed story is not a blank page.
import { useState, type JSX, type ReactNode } from 'react';

import { Button } from '../ui';

export function Opened({
  children,
  initial = true,
}: {
  children: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
  initial?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(initial);
  return (
    <>
      {!open && (
        <p className="empty">
          <Button onClick={() => setOpen(true)}>Reopen</Button>
        </p>
      )}
      {children(open, setOpen)}
    </>
  );
}
