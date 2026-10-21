import styles from './StocksPage.module.css';

export function StocksPage() {
  return (
    <section aria-label="Stocks" className={styles.page}>
      <div className={styles.placeholder}>
        <h1 className={styles.title}>Stocks</h1>
        <p className={styles.note}>[Stock screener — layout to be defined]</p>
      </div>
    </section>
  );
}
