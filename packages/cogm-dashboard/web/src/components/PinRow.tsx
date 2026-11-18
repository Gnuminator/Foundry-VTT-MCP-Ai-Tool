// The pinned Tool Runner calls as a row of buttons on the During bar. A click runs the pin as the
// Tool Runner would run it: a read at once (its answer shows under the row), a plan or a write
// through GM Actions and the confirm window. Pins are made and renamed in the Tool Runner.
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX } from 'react';

import { argLines, useGuardedTools } from '../lib/guarded';
import { runToolCall, type ToolResult } from '../lib/run-tool';
import { pinActions, usePinStore, type Pin } from '../lib/tool-pins';
import { Button } from '../ui';

import { useToast } from './Toasts';

export function PinRow(): JSX.Element | null {
  const { pins } = usePinStore();
  const guarded = useGuardedTools();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const busy = useRef(false);
  const [result, setResult] = useState<(ToolResult & { label: string }) | null>(null);

  if (pins.length === 0) return null;

  const run = (pin: Pin): void => {
    if (busy.current) {
      toast('Still waiting for the earlier pin to finish.', 'warn');
      return;
    }
    busy.current = true;
    setRunning(pin.id);
    setResult(null);
    void runToolCall(
      { guarded, toast, queryClient },
      { name: pin.tool, mutates: pin.mutates },
      pin.args,
      argLines(pin.args)
    )
      .then(shown => {
        // Cancelled or refused at the gate: nothing ran, so it is not a run.
        if (!shown) return;
        if (shown.ok) pinActions.ran({ tool: pin.tool, args: pin.args, mutates: pin.mutates });
        if (pin.mutates === 'read' && shown.ok) setResult({ ...shown, label: pin.label });
        else if (!shown.ok) setResult({ ...shown, label: pin.label });
      })
      .finally(() => {
        busy.current = false;
        setRunning(null);
      });
  };

  return (
    <div className="pin-row" id="pin-row" role="group" aria-label="Pinned tools">
      <span className="pin-row-label">Pinned</span>
      {pins.map(pin => (
        <Button
          key={pin.id}
          data-pin={pin.id}
          data-track="dash.pins.run"
          title={`${pin.tool}${pin.mutates === 'read' ? '' : ' (asks first)'}`}
          // aria-disabled, not disabled: the confirm window gives the focus back to this button.
          aria-disabled={running !== null || undefined}
          aria-busy={running === pin.id || undefined}
          onClick={() => run(pin)}
        >
          {pin.label}
        </Button>
      ))}
      {result && (
        <div className={`pin-result ${result.ok ? 'ok' : 'err'}`} id="pin-result" role="status">
          <div className="pin-result-head">
            <strong>{result.ok ? result.label : `${result.label}: error`}</strong>
            <button
              type="button"
              className="link-btn"
              data-track="dash.pins.result-close"
              onClick={() => setResult(null)}
            >
              Close
            </button>
          </div>
          <pre>
            {typeof result.payload === 'string'
              ? result.payload
              : (JSON.stringify(result.payload, null, 2) ?? 'null')}
          </pre>
        </div>
      )}
    </div>
  );
}
