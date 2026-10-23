import { PRODUCT_ICONS } from '../../data/catalog';
import { cx } from '../../lib/cx';
import { useT } from '../../i18n';
import { count, edge, price } from '../../lib/format';
import type { PricedSignal } from '../../lib/markets';
import { Icon } from '../ui/Icon';
import styles from './SignalCard.module.css';

interface SignalCardProps {
  signal: PricedSignal;
  active: boolean;
  onSelect: () => void;
}

export function SignalCard({ signal: s, active, onSelect }: SignalCardProps) {
  const t = useT();
  return (
    <button type="button" aria-pressed={active} className={cx(styles.card, active && styles.active)} onClick={onSelect}>
      <span className={styles.row}>
        <span className={styles.product}>
          <Icon name={PRODUCT_ICONS[s.product]} size={14} strokeWidth={2} />
          <span>
            {t.products[s.product]} · {s.market}
          </span>
        </span>
        <span className={styles.ev}>
          <span className={styles.evValue}>+{price(s.ev)}</span>
          <span className={styles.evUnit}>EV</span>
        </span>
      </span>
      <span className={styles.row}>
        <span className={styles.title}>{s.title}</span>
        <span className={cx(styles.side, s.side === 'yes' ? styles.sideYes : styles.sideNo)}>{t.side(s.sideLabel)}</span>
      </span>
      <span className={styles.prices}>
        <span>
          {t.signals.entry} <strong className={styles.quote}>{price(s.entry)}</strong>
        </span>
        <span>
          {t.signals.fair} <strong className={styles.quote}>{price(s.fair)}</strong>{' '}
          <span className={styles.diff}>({edge(s.fair, s.entry)})</span>
        </span>
      </span>
      <span className={styles.avg}>
        {t.signals.avgCost}{' '}
        <strong className={styles.avgValue}>
          {price(s.avg)} ({count(s.depth)})
        </strong>
      </span>
      <span className={styles.meta}>
        <span>
          {t.signals.updated(t.sinceUpdate(s.updatedSec), t.timeLeft(s.minutesLeft))}
        </span>
        <Icon name="arrowRight" size={16} strokeWidth={2} />
      </span>
    </button>
  );
}
