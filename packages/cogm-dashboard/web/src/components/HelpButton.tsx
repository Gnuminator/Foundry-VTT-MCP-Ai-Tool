import { createContext, useContext, type JSX } from 'react';

/** Opens the help pane at "page" or "page#anchor" (HelpProvider in Help.tsx). */
export type OpenHelp = (target: string) => void;

export const HelpContext = createContext<OpenHelp>(() => undefined);

export function useHelp(): OpenHelp {
  return useContext(HelpContext);
}

/** The "?" after a pane's title: opens the guide at that pane's heading. */
export function HelpButton({ page }: { page: string }): JSX.Element {
  const openHelp = useHelp();
  return (
    <button
      type="button"
      className="help-q"
      data-track="dash.help.panel"
      title="What is this? Opens the guide"
      aria-label="Help for this panel"
      onClick={() => openHelp(page)}
    >
      ?
    </button>
  );
}
