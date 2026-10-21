import type { MarketEvent, Outcome } from '../../data/catalog';
import { cents, chance, money } from '../../lib/format';
import styles from './MarketsTable.module.css';

interface MarketsTableProps {
  event: MarketEvent;
  outcomes: Outcome[];
}

/** Prediction page: each outcome with its chance and Yes/No buy buttons. */
export function MarketsTable({ event, outcomes }: MarketsTableProps) {
  const multi = event.kind === 'multi';
  const yesLabel = multi ? 'Yes' : (event.yesLabel ?? 'Yes');
  const noLabel = multi ? 'No' : (event.noLabel ?? 'No');

  return (
    <div className={styles.table}>
      {outcomes.map((o) => (
        <div key={o.id} className={styles.row}>
          <div className={styles.label}>
            <span className={styles.name}>{o.label}</span>
            <span className={styles.vol}>Vol {money(o.vol)}</span>
          </div>
          <div className={styles.chance}>
            <span className={styles.chanceValue}>{chance(o.yes)}</span>
            <span className={styles.chanceSub}>{multi ? 'chance' : `${yesLabel} chance`}</span>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.yes}>
              {yesLabel} {cents(o.yes)}
            </button>
            <button type="button" className={styles.no}>
              {noLabel} {cents(o.no)}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
