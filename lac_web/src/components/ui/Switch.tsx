import { cx } from '../../lib/cx';
import styles from './Switch.module.css';

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={styles.switch} onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={cx(styles.track, checked && styles.on)}>
        <span className={styles.knob} />
      </span>
    </button>
  );
}
