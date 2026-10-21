import type { InputHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import styles from './TextField.module.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** `caps` is the small uppercase eyebrow label. */
  labelStyle?: 'default' | 'caps';
  inputClassName?: string;
}

export function TextField({ label, labelStyle = 'default', className, inputClassName, readOnly, ...rest }: TextFieldProps) {
  return (
    <label className={cx(styles.field, className)}>
      <span className={labelStyle === 'caps' ? styles.capsLabel : styles.label}>{label}</span>
      <input readOnly={readOnly} className={cx(styles.input, readOnly && styles.readOnly, inputClassName)} {...rest} />
    </label>
  );
}
