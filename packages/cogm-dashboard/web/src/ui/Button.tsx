import { useEffect, useState, type ComponentProps, type JSX } from 'react';

import { cx } from './cx';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'danger';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** `sm` is the old `.btn-small`. */
  size?: 'md' | 'sm';
  /**
   * An answer is awaited: the button says `busyLabel` (what it is doing, "Starting...") and stays
   * locked until it comes; after 2 seconds it says "Waiting for Foundry..." instead. The button
   * stays focusable (aria-disabled, not disabled) so a keyboard user keeps their place.
   */
  busy?: boolean;
  busyLabel?: string;
}

/** How long a busy button waits before it says the answer is slow. */
export const SLOW_AFTER_MS = 2000;

/** True once `active` has been true for `ms`; false again as soon as it stops. */
export function useAfter(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return undefined;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return (): void => clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}

const VARIANT_CLASS: Record<ButtonVariant, string | false> = {
  default: false,
  primary: 'btn-primary',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
};

/**
 * A button in the old page's look (`.btn`, `.btn-primary`, ...), which styles.css owns. The type is
 * not defaulted: a button in a form submits it, as a plain <button> does. Everything else
 * (data-track, id, disabled, onClick) goes through.
 */
export function Button({
  variant = 'default',
  size = 'md',
  className,
  busy = false,
  busyLabel = 'Working...',
  children,
  onClick,
  ...rest
}: ButtonProps): JSX.Element {
  const slow = useAfter(busy, SLOW_AFTER_MS);
  return (
    <button
      className={cx('btn', VARIANT_CLASS[variant], size === 'sm' && 'btn-small', className)}
      {...rest}
      {...(busy ? { 'aria-busy': true, 'aria-disabled': true } : {})}
      onClick={busy ? undefined : onClick}
    >
      {busy ? (slow ? 'Waiting for Foundry...' : busyLabel) : children}
    </button>
  );
}

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** The accessible name; an icon has no text of its own. */
  label: string;
  /**
   * What the tooltip says. Radix reads it as the button's description, so it must add to the
   * label, not repeat it ("Close (Esc)" on a button named "Close"). The name stays the label.
   */
  tip: string;
}

/**
 * A square icon button (`.icon-btn`): the drawer's close, for one. It has a Tooltip (so no native
 * `title`); the `aria-label` is the accessible name and the tip its description.
 */
export function IconButton({ label, tip, className, ...rest }: IconButtonProps): JSX.Element {
  return (
    <Tooltip content={tip}>
      <button className={cx('icon-btn', className)} aria-label={label} {...rest} />
    </Tooltip>
  );
}
