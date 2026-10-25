import type { MarketEvent, Outcome } from '../../data/catalog';
import { marketAnchorId, sideLabel, type Highlight } from '../../lib/markets';
import { cx } from '../../lib/cx';
import { useT } from '../../i18n';
import { cents, chance, money } from '../../lib/format';
import styles from './MarketsTable.module.css';

interface MarketsTableProps {
  event: MarketEvent;
  outcomes: Outcome[];
  highlight: Highlight | null;
}

/** Prediction page: each outcome with its chance and Yes/No buy buttons. */
export function MarketsTable({ event, outcomes, highlight }: MarketsTableProps) {
  const t = useT();
  const multi = event.kind === 'multi';
  const yesLabel = sideLabel(event, 'yes');
  const noLabel = sideLabel(event, 'no');

  return (
    <div className={styles.table}>
      {outcomes.map((o) => (
        <div
          key={o.id}
          id={marketAnchorId(event.id, o.id)}
          className={cx(styles.row, highlight?.outcomeId === o.id && styles.highlightRow)}
        >
          <div className={styles.label}>
            <span className={styles.name}>{o.label}</span>
            <span className={styles.vol}>
              {t.markets.vol} {money(o.vol)}
            </span>
          </div>
          <div className={styles.chance}>
            <span className={styles.chanceValue}>{chance(o.yes)}</span>
            <span className={styles.chanceSub}>{multi ? t.markets.chance : t.markets.sideChance(t.side(yesLabel))}</span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={cx(
                styles.yes,
                highlight?.outcomeId === o.id && highlight.side === 'yes' && styles.highlightSide,
              )}
            >
              {t.side(o.yesLabel ?? yesLabel)} {cents(event.source === 'live' ? (o.yesAsk ?? null) : o.yes)}
            </button>
            <button
              type="button"
              className={cx(
                styles.no,
                highlight?.outcomeId === o.id && highlight.side === 'no' && styles.highlightSide,
              )}
            >
              {t.side(o.noLabel ?? noLabel)} {cents(event.source === 'live' ? (o.noAsk ?? null) : o.no)}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
