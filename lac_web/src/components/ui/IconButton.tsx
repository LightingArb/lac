import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from './Icon';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; icon-only buttons have no visible text. */
  label: string;
  icon: IconName;
  iconSize?: number;
  strokeWidth?: number;
  variant?: 'ghost' | 'outline';
}

export function IconButton({
  label,
  icon,
  iconSize = 20,
  strokeWidth = 1.8,
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={cx(styles.iconButton, styles[variant], className)} {...rest}>
      <Icon name={icon} size={iconSize} strokeWidth={strokeWidth} />
    </button>
  );
}
