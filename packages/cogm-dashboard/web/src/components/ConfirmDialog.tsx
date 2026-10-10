// The confirm window for a planned change that is not a one-click write (a reveal, a delete, ...).
// Port of the old page's confirmAction (public/app.js) on its markup and styles (styles.css
// .modal-backdrop, .modal, .change-diff, .modal-destructive), as a modal Radix dialog: the page
// behind waits until the GM answers. useGuardedChange (lib/guarded.ts) asks it through useConfirm.
import * as Dialog from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { useEscapeClose } from '../lib/escape';
import { usage } from '../lib/usage';
import { Button } from '../ui';

/** What the window shows: the plan's summary and what it will change. */
export interface ConfirmRequest {
  summary?: string | undefined;
  /** One line per change; an empty list says "(no changes listed)". */
  diff: string[];
  /** A delete, a reveal or a hide: Confirm waits for the "I understand" tick. */
  destructive: boolean;
  /**
   * What had focus when the change started (the button clicked), read before the panel disabled
   * it: by the time the window opens, a disabled button has already lost focus to the page body.
   */
  returnTo?: HTMLElement | null;
}

/** Opens the window; true when the GM confirmed, false on Cancel, Escape or a click outside. */
export type AskConfirm = (request: ConfirmRequest) => Promise<boolean>;

/** The element with focus, or null when it is the page body (nothing to go back to). */
export function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

const ConfirmContext = createContext<AskConfirm>(() => Promise.resolve(false));

export function useConfirm(): AskConfirm {
  return useContext(ConfirmContext);
}

/** Holds the one confirm window of the page. Mounted once, in App. */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [ticked, setTicked] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const answer = useCallback((ok: boolean): void => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(ok);
  }, []);

  // Where focus goes back to on close: what had it when the change started.
  const returnTo = useRef<HTMLElement | null>(null);

  const ask = useCallback<AskConfirm>(next => {
    // One question at a time: a new one answers the open one with no (and keeps its way back).
    if (resolver.current) {
      resolver.current(false);
    } else {
      returnTo.current = next.returnTo ?? focusedElement();
    }
    setTicked(false);
    setRequest(next);
    return new Promise<boolean>(resolve => {
      resolver.current = resolve;
    });
  }, []);

  const open = request !== null;
  const escape = (): void => usage().track('shortcut', 'dash.shortcut.escape-modal');
  // With a toast up, the toast hands Escape on to the newest open panel: this window.
  useEscapeClose(open, () => {
    escape();
    answer(false);
  });

  // Radix would give focus back to what had it when the window opened, which is the page body
  // once the panel disabled the button clicked. So focus goes back here: to that button if it is
  // enabled, else to the panel it sits in (a drawer) until the change is over and the button is
  // enabled again. If the button stays disabled (nothing left to reveal), the panel keeps focus.
  const restoreFocus = (event: Event): void => {
    const back = returnTo.current;
    returnTo.current = null;
    event.preventDefault();
    if (!back?.isConnected) return;
    if (!back.matches(':disabled')) {
      back.focus();
      return;
    }
    const panel = back.closest<HTMLElement>('[role="dialog"]');
    if (!panel) return;
    panel.focus();
    const done = (): void => {
      watch.disconnect();
      panel.removeEventListener('focusout', done);
    };
    const watch = new MutationObserver(() => {
      if (back.matches(':disabled')) return;
      done();
      if (document.activeElement === panel) back.focus();
    });
    watch.observe(back, { attributes: true, attributeFilter: ['disabled'] });
    // The GM moved focus on (or the panel closed): leave it where it went.
    panel.addEventListener('focusout', done);
  };

  const destructive = request?.destructive === true;
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={isOpen => {
          if (!isOpen) answer(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop" id="modal-backdrop">
            {request && (
              <Dialog.Content
                className="modal"
                id="modal"
                onEscapeKeyDown={escape}
                onCloseAutoFocus={restoreFocus}
              >
                {/* No ids of their own here: Radix names and describes the window by its ids. */}
                <Dialog.Title asChild>
                  <h3>{destructive ? 'Destructive action' : 'Confirm action'}</h3>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <div className="modal-body">
                    {request.summary && <p className="modal-summary">{request.summary}</p>}
                    <ul className="change-diff">
                      {request.diff.length > 0 ? (
                        request.diff.map((line, i) => <li key={i}>{line}</li>)
                      ) : (
                        <li>(no changes listed)</li>
                      )}
                    </ul>
                  </div>
                </Dialog.Description>
                {destructive && (
                  <label className="modal-destructive" id="modal-destructive">
                    <input
                      type="checkbox"
                      id="modal-destructive-check"
                      data-track="dash.modal.destructive-check"
                      checked={ticked}
                      onChange={e => setTicked(e.target.checked)}
                    />
                    <span>I understand this changes the live game and may be hard to undo.</span>
                  </label>
                )}
                <div className="modal-actions">
                  <Button
                    type="button"
                    id="modal-cancel"
                    data-track="dash.modal.cancel"
                    onClick={() => answer(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    id="modal-confirm"
                    data-track="dash.modal.confirm"
                    disabled={destructive && !ticked}
                    onClick={() => answer(true)}
                  >
                    {destructive ? 'Run destructive action' : 'Confirm'}
                  </Button>
                </div>
              </Dialog.Content>
            )}
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}
