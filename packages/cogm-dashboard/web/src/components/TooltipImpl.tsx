import { Tooltip as RadixTooltip } from 'radix-ui';
import type { JSX, ReactElement, ReactNode } from 'react';

import styles from '../ui/Tooltip.module.css';

/**
 * The Radix half of Tooltip (ui/Tooltip.tsx), its own chunk so the first load does not carry it.
 * It lives outside ui/ on purpose: vite.config.ts folds everything under ui/ into one chunk.
 * Each tooltip brings its own provider: the delays are the same, only the "next one opens at once"
 * grouping between neighbours is gone.
 */
export function TooltipImpl({
  content,
  side,
  trigger,
}: {
  content: ReactNode;
  side: 'top' | 'right' | 'bottom' | 'left';
  trigger: ReactElement;
}): JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={300}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{trigger}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className={styles.content} side={side} sideOffset={6}>
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
