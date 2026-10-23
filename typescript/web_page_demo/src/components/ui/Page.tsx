import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Page.module.css';

interface PageProps {
  /** Accessible name of the page region. */
  label: string;
  width?: 'wide' | 'narrow';
  children: ReactNode;
}

/** Scrollable content area used by every non-market page. */
export function Page({ label, width = 'wide', children }: PageProps) {
  return (
    <section aria-label={label} className={styles.page}>
      <div className={cx(styles.inner, styles[width])}>{children}</div>
    </section>
  );
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
  return (
    <div className={cx(styles.header, className)}>
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
  );
}
