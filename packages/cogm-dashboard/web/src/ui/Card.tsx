// Small building blocks inside a panel's body: Card, Section, Stat and Pill. Card and Section are
// new (their look is Card.module.css, on the tokens); Stat and Pill render the old page's markup
// (moments.css .stat-card, .feature-pill, styles.css .condition-chip), so a screen that moves
// onto them keeps its look.
import type { ComponentProps, JSX, ReactNode } from 'react';

import styles from './Card.module.css';
import { cx } from './cx';

interface CardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** A heading (h3) at the top of the card. */
  title?: ReactNode;
  /** Short text at the right of the heading. */
  aside?: ReactNode;
}

/** A framed group of related things inside a panel. */
export function Card({ title, aside, className, children, ...rest }: CardProps): JSX.Element {
  return (
    <section className={cx('card', styles.card, className)} {...rest}>
      {(title !== undefined || aside !== undefined) && (
        <header className={styles.head}>
          {title !== undefined && <h3 className={styles.title}>{title}</h3>}
          {aside !== undefined && <span className={styles.aside}>{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

interface SectionProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The heading (h3) above the content. */
  title: ReactNode;
}

/** A titled stretch of a panel's body, without a frame. */
export function Section({ title, className, children, ...rest }: SectionProps): JSX.Element {
  return (
    <div className={cx(styles.section, className)} {...rest}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

interface StatProps {
  label: string;
  /** The number, or the name when `name` is set. */
  value: ReactNode;
  /** The line under it. */
  hint?: ReactNode;
  /** A name instead of a number: smaller, wraps (.stat-who). */
  name?: boolean;
}

/** One figure with its label: the After view's stat card. */
export function Stat({ label, value, hint, name = false }: StatProps): JSX.Element {
  return (
    <div className="stat-card">
      <h4>{label}</h4>
      <p className={name ? 'stat-who' : 'stat-big'}>{value}</p>
      {hint !== undefined && <span className="pf-detail">{hint}</span>}
    </div>
  );
}

interface PillProps {
  children: ReactNode;
  /** `status` is the feature pill (on = good, off = warn, none = plain); `condition` the amber chip. */
  variant?: 'status' | 'condition';
  tone?: 'on' | 'off';
  title?: string;
}

/** A small rounded label. */
export function Pill({ children, variant = 'status', tone, title }: PillProps): JSX.Element {
  const className = variant === 'condition' ? 'condition-chip' : cx('feature-pill', tone);
  return (
    <span className={className} {...(title !== undefined ? { title } : {})}>
      {children}
    </span>
  );
}
