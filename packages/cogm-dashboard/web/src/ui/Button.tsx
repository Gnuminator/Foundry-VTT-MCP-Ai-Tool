import type { ComponentProps, JSX } from 'react';

import { cx } from './cx';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'danger';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** `sm` is the old `.btn-small`. */
  size?: 'md' | 'sm';
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
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      className={cx('btn', VARIANT_CLASS[variant], size === 'sm' && 'btn-small', className)}
      {...rest}
    />
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
