import { cx } from '../../lib/cx';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** `strong` uses the darker, rounder track (billing period). */
  tone?: 'default' | 'strong';
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  tone = 'default',
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx(styles.track, tone === 'strong' && styles.strong)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={cx(styles.segment, styles[size], selected && styles.selected)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
