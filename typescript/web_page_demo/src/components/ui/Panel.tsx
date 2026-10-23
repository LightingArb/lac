import type { HTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import styles from './Panel.module.css';

/** White rounded card with the standard border, used for page sections. */
export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(styles.panel, className)} {...rest} />;
}
