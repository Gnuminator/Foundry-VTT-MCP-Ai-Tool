import type { ComponentProps, JSX } from 'react';

import { cx } from './cx';

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
}

/** A square icon button (`.icon-btn`): the drawer's close, for one. */
export function IconButton({ label, className, ...rest }: IconButtonProps): JSX.Element {
  return <button className={cx('icon-btn', className)} aria-label={label} {...rest} />;
}
