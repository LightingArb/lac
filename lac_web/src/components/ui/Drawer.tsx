import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import styles from './Drawer.module.css';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  /** Accessible name of the drawer. */
  label: string;
  children: ReactNode;
}

/**
 * Full-height panel that slides in from the edge of the screen. Built on the native
 * modal <dialog>, so it traps focus, closes on Esc and returns focus when closed.
 */
export function Drawer({ open, onClose, side = 'left', label, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cx(styles.drawer, styles[side])}
      onClose={onClose}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
