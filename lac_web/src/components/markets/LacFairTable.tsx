import type { MarketEvent, Outcome, Side } from '../../data/catalog';
import { cx } from '../../lib/cx';
import { count, edge, money, price } from '../../lib/format';
import { cellKey, fairValue, marketAnchorId, type PricedSignal } from '../../lib/markets';
import styles from './LacFairTable.module.css';

interface LacFairTableProps {
  event: MarketEvent;
  outcomes: Outcome[];
  signalByCell: Record<string, PricedSignal>;
  highlight: PricedSignal | null;
}

/** Signal page: market price vs LAC fair value for both sides of every outcome. */
export function LacFairTable({ event, outcomes, signalByCell, highlight }: LacFairTableProps) {
  const multi = event.kind === 'multi';
  const yesLabel = multi ? 'Yes' : (event.yesLabel ?? 'Yes');
  const noLabel = multi ? 'No' : (event.noLabel ?? 'No');

  return (
    <div className={styles.scroll}>
      <div className={styles.table}>
        <div className={cx(styles.grid, styles.sideHead)}>
          <span />
          <span className={styles.yesHead}>{yesLabel}</span>
          <span className={styles.noHead}>{noLabel}</span>
        </div>
        <div className={cx(styles.grid, styles.colHead)}>
          <span>Outcome</span>
          <ColumnLabels />
          <ColumnLabels />
        </div>
        {outcomes.map((o) => (
          <div key={o.id} id={marketAnchorId(event.id, o.id)} className={cx(styles.grid, styles.row)}>
            <span className={styles.outcome}>
              <span className={styles.outcomeName}>{o.label}</span>
              <span className={styles.muted}>Vol {money(o.vol)}</span>
            </span>
            {(['yes', 'no'] as const).map((side) => (
              <FairCell
                key={side}
                outcome={o}
                side={side}
                signal={signalByCell[cellKey(event.id, o.id, side)]}
                highlighted={highlight?.outcomeId === o.id && highlight.side === side}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnLabels() {
  return (
    <span className={styles.triple}>
      <span>Market</span>
      <span>LAC Fair</span>
      <span>Avg. Cost</span>
    </span>
  );
}

interface FairCellProps {
  outcome: Outcome;
  side: Side;
  signal: PricedSignal | undefined;
  highlighted: boolean;
}

function FairCell({ outcome, side, signal, highlighted }: FairCellProps) {
  const market = side === 'yes' ? outcome.yes : outcome.no;
  const fair = fairValue(outcome, side);
  return (
    <span className={cx(styles.cell, highlighted ? styles.cellHighlight : signal && styles.cellPositive)}>
      <span className={styles.strong}>{price(market)}</span>
      <span className={styles.stack}>
        <span className={styles.strong}>{price(fair)}</span>
        <span className={signal ? styles.diffPositive : styles.muted}>{edge(fair, market)}</span>
      </span>
      <span className={styles.stack}>
        <span className={styles.strong}>{signal ? price(signal.avg) : '—'}</span>
        <span className={styles.muted}>{signal ? `(${count(signal.depth)})` : ''}</span>
      </span>
    </span>
  );
}
