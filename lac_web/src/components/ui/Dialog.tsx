import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { IconButton } from './IconButton';
import styles from './Dialog.module.css';

interface DialogProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Modal built on the native <dialog>, which traps focus and closes on Esc. Mount it to open it. */
export function Dialog({ title, subtitle, onClose, children }: DialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Unmounting removes the element, which also takes it out of the top layer; no close() needed.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.heading}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </span>
          <IconButton label={t.common.close} icon="close" strokeWidth={2} onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}
