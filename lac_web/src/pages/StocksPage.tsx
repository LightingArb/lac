import { useT } from '../i18n';
import styles from './StocksPage.module.css';

export function StocksPage() {
  const t = useT();
  return (
    <section aria-label={t.stocks.title} className={styles.page}>
      <div className={styles.placeholder}>
        <h1 className={styles.title}>{t.stocks.title}</h1>
        <p className={styles.note}>{t.stocks.note}</p>
      </div>
    </section>
  );
}
