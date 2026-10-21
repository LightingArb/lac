import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'muted' | 'dark';

/** Class names for a button-styled element, so links can share the look. */
export function buttonClass(variant: ButtonVariant, block = false, className?: string): string {
  return cx(styles.button, styles[variant], block && styles.block, className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
}

export function Button({ variant = 'primary', block = false, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, block, className)} {...rest} />;
}
