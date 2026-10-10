import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentProps, JSX } from 'react';

import { cx } from './cx';
import styles from './Tabs.module.css';

/**
 * Tabs inside a panel (not the header's Before / During / After, which are Moments.tsx). Radix
 * does the work: arrow keys move between the tabs, Home and End jump, and the selected panel is
 * the only one in the page. Use as
 * `<Tabs defaultValue="a"><TabsList aria-label="..."><TabsTrigger value="a">A</TabsTrigger>
 * </TabsList><TabsContent value="a">...</TabsContent></Tabs>`.
 */
export function Tabs({ className, ...rest }: ComponentProps<typeof RadixTabs.Root>): JSX.Element {
  return <RadixTabs.Root className={cx(styles.root, className)} {...rest} />;
}

/** The row of tabs; give it an `aria-label`. */
export function TabsList({
  className,
  ...rest
}: ComponentProps<typeof RadixTabs.List>): JSX.Element {
  return <RadixTabs.List className={cx(styles.list, className)} {...rest} />;
}

export function TabsTrigger({
  className,
  ...rest
}: ComponentProps<typeof RadixTabs.Trigger>): JSX.Element {
  return <RadixTabs.Trigger className={cx(styles.tab, className)} {...rest} />;
}

export function TabsContent({
  className,
  ...rest
}: ComponentProps<typeof RadixTabs.Content>): JSX.Element {
  return <RadixTabs.Content className={cx(styles.panel, className)} {...rest} />;
}
