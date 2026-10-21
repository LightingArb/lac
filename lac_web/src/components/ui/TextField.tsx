import type { InputHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import styles from './TextField.module.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** `caps` is the small uppercase eyebrow label. */
  labelStyle?: 'default' | 'caps';
  inputClassName?: string;
  /** Shown under the input and marks it invalid. */
  error?: string;
}

export function TextField({
  label,
  labelStyle = 'default',
  className,
  inputClassName,
  readOnly,
  error,
  ...rest
}: TextFieldProps) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={labelStyle === 'caps' ? styles.capsLabel : styles.label}>{label}</span>
      <input
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        className={cx(styles.input, readOnly && styles.readOnly, error && styles.invalid, inputClassName)}
        {...rest}
      />
      {error && <span className={styles.error}>{error}</span>}
    </label>
  );
}
