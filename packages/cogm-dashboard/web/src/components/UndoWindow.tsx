// The undo window of Recent Changes' Everyone tab (I-109): one modal that shows one stage of the
// undo choice at a time (just this or everything since, the plan's lines, the rewind and its
// second question) and answers with the button pressed. Port of the old page's showUndoDialog
// (public/app.js) on its markup and styles (styles.css .modal-wide, .undo-later, .undo-note,
// .undo-advanced), as a modal Radix dialog like the confirm window. The stages and what each shows
// are in lib/changes.ts; the flow that walks them is in panels/RecentChanges.tsx.
import { Dialog } from 'radix-ui';
import { useCallback, useRef, useState, type JSX } from 'react';

import type { LaterChange, UndoButton, UndoDialogModel, UndoKey } from '../lib/changes';
import { useEscapeClose } from '../lib/escape';
import { usage } from '../lib/usage';
import { Button } from '../ui';

/** Shows one stage; resolves with the key of the button pressed, or null when it was closed. */
export type AskUndo = (model: UndoDialogModel) => Promise<UndoKey | null>;

/** The usage name of each button, written out so scripts/usage-catalog.mjs finds them. */
function UndoActionButton({
  button,
  disabled,
  onPress,
}: {
  button: UndoButton;
  disabled: boolean;
  onPress: (key: UndoKey) => void;
}): JSX.Element {
  const props = {
    type: 'button',
    id: `undo-${button.key}`,
    variant: button.danger ? 'danger' : button.primary ? 'primary' : 'default',
    disabled,
    onClick: () => onPress(button.key),
  } as const;
  switch (button.key) {
    case 'cancel':
      return (
        <Button {...props} data-track="dash.undo.cancel">
          {button.label}
        </Button>
      );
    case 'just-this':
      return (
        <Button {...props} data-track="dash.undo.just-this">
          {button.label}
        </Button>
      );
    case 'everything-since':
      return (
        <Button {...props} data-track="dash.undo.everything-since">
          {button.label}
        </Button>
      );
    case 'rewind':
      return (
        <Button {...props} data-track="dash.undo.rewind">
          {button.label}
        </Button>
      );
    case 'next':
      return (
        <Button {...props} data-track="dash.undo.next">
          {button.label}
        </Button>
      );
    case 'apply':
      return (
        <Button {...props} data-track="dash.undo.apply">
          {button.label}
        </Button>
      );
  }
}

const laterLine = (l: LaterChange): string => {
  const when = l.at ? `${new Date(l.at).toLocaleString()}, ` : '';
  return `${when}${l.by}: ${l.summary}`;
};

/**
 * The undo window and the function that opens it. Render `element` once in the panel; `ask` shows
 * a stage and the window stays closed in between (the flow may be planning). Escape, a click
 * outside and Cancel all answer null or `cancel`, which end the flow.
 */
export function useUndoWindow(): { ask: AskUndo; close: () => void; element: JSX.Element } {
  const [model, setModel] = useState<UndoDialogModel | null>(null);
  const [ticked, setTicked] = useState(false);
  const resolver = useRef<((key: UndoKey | null) => void) | null>(null);

  const answer = useCallback((key: UndoKey | null): void => {
    const resolve = resolver.current;
    resolver.current = null;
    setModel(null);
    resolve?.(key);
  }, []);

  const ask = useCallback<AskUndo>(next => {
    // One stage at a time: a new one answers the open one with null.
    resolver.current?.(null);
    setTicked(false);
    setModel(next);
    return new Promise<UndoKey | null>(resolve => {
      resolver.current = resolve;
    });
  }, []);

  const open = model !== null;
  const escape = (): void => usage().track('shortcut', 'dash.shortcut.escape-undo');
  // With a toast up, the toast hands Escape on to the newest open panel: this window.
  useEscapeClose(open, () => {
    escape();
    answer(null);
  });

  const element = (
    <Dialog.Root
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) answer(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" id="undo-backdrop">
          {model && (
            <Dialog.Content
              className="modal modal-wide"
              id="undo-window"
              onEscapeKeyDown={escape}
              // The flow gives focus back when it ends; between two stages it must not jump.
              onCloseAutoFocus={event => event.preventDefault()}
              onOpenAutoFocus={event => {
                // The lines are a tab stop (they can scroll) but not where focus starts: the
                // tick box of a destructive stage, else Cancel.
                event.preventDefault();
                document
                  .getElementById(model.destructive ? 'undo-destructive-check' : 'undo-cancel')
                  ?.focus();
              }}
            >
              <Dialog.Title asChild>
                <h3>{model.title}</h3>
              </Dialog.Title>
              <Dialog.Description asChild>
                <div className="modal-body" id="undo-body">
                  {model.intro && <p className="modal-summary">{model.intro}</p>}
                  {model.later && model.later.length > 0 && (
                    <>
                      <p>{model.laterTitle}</p>
                      <ul className="undo-later" tabIndex={0} aria-label="Changed since then">
                        {model.later.map((l, i) => (
                          <li key={i}>{laterLine(l)}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {model.lines.length > 0 && (
                    <ul className="change-diff" tabIndex={0} aria-label="Changes">
                      {model.lines.map((l, i) => (
                        <li key={i} {...(l.note ? { className: 'undo-note' } : {})}>
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {model.advanced && (
                    <details className="undo-advanced">
                      <summary data-track="dash.undo.advanced">{model.advanced.title}</summary>
                      <p>{model.advanced.text}</p>
                      <UndoActionButton
                        button={model.advanced.button}
                        disabled={false}
                        onPress={answer}
                      />
                    </details>
                  )}
                </div>
              </Dialog.Description>
              {model.destructive && (
                <label className="modal-destructive" id="undo-destructive">
                  <input
                    type="checkbox"
                    id="undo-destructive-check"
                    data-track="dash.undo.destructive-check"
                    checked={ticked}
                    onChange={e => setTicked(e.target.checked)}
                  />
                  <span>I understand this changes the live game and may be hard to undo.</span>
                </label>
              )}
              <div className="modal-actions" id="undo-actions">
                {model.buttons.map(b => (
                  <UndoActionButton
                    key={b.key}
                    button={b}
                    disabled={b.needsCheck === true && !ticked}
                    onPress={answer}
                  />
                ))}
              </div>
            </Dialog.Content>
          )}
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
  return { ask, close: () => answer(null), element };
}
