import { createContext, useContext, type JSX } from 'react';

// Not from '../ui': its index pulls in Panel, which imports this file.
import { Tooltip } from '../ui/Tooltip';

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
    <Tooltip content="What is this? Opens the guide">
      <button
        type="button"
        className="help-q"
        data-track="dash.help.panel"
        aria-label="Help for this panel"
        onClick={() => openHelp(page)}
      >
        ?
      </button>
    </Tooltip>
  );
}
