import { useEffect, useRef } from 'react';
import { USDT_PROVIDERS } from '../data/providers';
import { buttonClass } from './ui/Button';
import { Icon } from './ui/Icon';
import { IconButton } from './ui/IconButton';
import styles from './BuyUsdtDialog.module.css';

interface BuyUsdtDialogProps {
  onClose: () => void;
}

/** Modal listing partner sites that sell USDT. Uses the native <dialog> for focus trapping and Esc. */
export function BuyUsdtDialog({ onClose }: BuyUsdtDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // Unmounting removes the element, which also takes it out of the top layer; no close() needed.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="buy-usdt-title"
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
            <h2 id="buy-usdt-title" className={styles.title}>
              Buy USDT
            </h2>
            <span className={styles.subtitle}>Pick a partner site. You pay and receive USDT there.</span>
          </span>
          <IconButton label="Close" icon="close" strokeWidth={2} onClick={onClose} />
        </div>

        <ul className={styles.providers}>
          {USDT_PROVIDERS.map((p) => (
            <li key={p.name} className={styles.provider}>
              <span className={styles.providerLogo}>{p.abbr}</span>
              <span className={styles.providerInfo}>
                <span className={styles.providerName}>{p.name}</span>
                <span className={styles.providerMethods}>{p.methods}</span>
                <span className={styles.providerTerms}>
                  Fee {p.fee} · Min {p.min} · {p.networks}
                </span>
              </span>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className={buttonClass('dark', false, styles.goButton)}>
                Go to site
                <Icon name="external" size={14} strokeWidth={2} />
              </a>
            </li>
          ))}
        </ul>

        <p className={styles.disclaimer}>
          External sites. Payment, KYC and delivery are handled by each provider; LAC never receives or holds your funds.
          Fees are set by the provider — check the final amount on their page before paying.
        </p>
      </div>
    </dialog>
  );
}
