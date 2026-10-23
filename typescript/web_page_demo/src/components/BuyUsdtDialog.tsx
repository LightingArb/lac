import { USDT_PROVIDERS, methodList } from '../data/providers';
import { useT } from '../i18n';
import { buttonClass } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Icon } from './ui/Icon';
import styles from './BuyUsdtDialog.module.css';

interface BuyUsdtDialogProps {
  onClose: () => void;
}

/** Modal listing partner sites that sell USDT. */
export function BuyUsdtDialog({ onClose }: BuyUsdtDialogProps) {
  const t = useT();
  return (
    <Dialog title={t.buyUsdt.title} subtitle={t.buyUsdt.subtitle} onClose={onClose}>
      <ul className={styles.providers}>
        {USDT_PROVIDERS.map((p) => (
          <li key={p.name} className={styles.provider}>
            <span className={styles.providerLogo}>{p.abbr}</span>
            <span className={styles.providerInfo}>
              <span className={styles.providerName}>{p.name}</span>
              <span className={styles.providerMethods}>{methodList(t, p.methods)}</span>
              <span className={styles.providerTerms}>{t.buyUsdt.terms(p.fee, p.min, p.networks)}</span>
            </span>
            <a href={p.url} target="_blank" rel="noopener noreferrer" className={buttonClass('dark', false, styles.goButton)}>
              {t.buyUsdt.go}
              <Icon name="external" size={14} strokeWidth={2} />
            </a>
          </li>
        ))}
      </ul>

      <p className={styles.disclaimer}>{t.buyUsdt.disclaimer}</p>
    </Dialog>
  );
}
